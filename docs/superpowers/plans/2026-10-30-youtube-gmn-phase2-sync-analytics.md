# YouTube + Google Meu Negócio, Phase 2 (sync, deletion duties, analytics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec §10 item 2 in full. Daily YouTube and Google Meu Negócio data syncs into service-role history tables. The deletion and revocation duties that Phase 1's privacy text already promises are enforced. Two analytics tabs (mockups 3-4) read that data, all still behind the dark flags. Tasks 1-9 form a shippable backend subset on their own: the privacy duties hold even if the tabs (Tasks 10-15) slip to a later PR.

**Architecture:**
- **Shared modules:** per-unit sync logic lives in `_shared/youtube-sync.ts` and `_shared/gbp-sync.ts`, called by two hourly crons and by a manual `POST /sync` route on `google-integration`.
- **Deletion in SQL:** SECURITY DEFINER SQL owns every deletion decision. That covers the YouTube purge on unlink and on `invalid_grant`, the 30-day expiry, and the per-sub "release if unused" step, all under the Phase 1 per-sub advisory lock.
- **Google calls in Deno:** edge code only calls Google and Storage, after commit.
- **Read functions:** read-only functions (`youtube-analytics`, `gbp-analytics`) back the tabs, mirroring `tiktok-analytics`.

**Tech Stack:** Postgres migrations + psql entitlement suites, Deno edge functions (`deno test`, DI handler factories, `createSupabaseQueryMock`), React 19 + TanStack Query + react-i18next + Chart.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md`. This plan implements §4.2's invalid_grant branch, §4.6's deletion and storage rules, §5 and §7, plus the Phase 1 review gaps listed under Task 9. Phase 1 (PR oeduardobrandao/sm-crm#772) must be merged or stacked first. Mockup inventory: `https://claude.ai/artifact/Tc2YpgUoMCKqEKvtBNvKde`, boards 3 and 4.

## Global Constraints

- **Copy:** all user-facing text pt-BR with `en` keys, sentence case, **no em dashes**. Tab strings go in new namespaces `analyticsYoutube` and `analyticsGoogle`, registered for **both** `pt` and `en` in `apps/crm/src/boot/i18nResources.ts`, or `packages/i18n/__tests__/locales.test.ts` fails.
- **Error handling:** CORS only via `buildCorsHeaders(req)`. Never return raw error details: use `internalServerError(json, scope, err)` from `_shared/http.ts`. Every Google, R2 and Storage call carries `AbortSignal.timeout` (via `googleFetch`, 10 s default). Persist each state change before the next network call (spec §5.3).
- **Tokens:** `getFreshGoogleToken(svc, connectionId)` is the only token read path. Never select token columns from read functions. Never delete `google_connections` rows except through `_google_revoke_if_unused` (CLAUDE.md gotcha).
- **Tenant and access:**
  - Tenant resolution reuses `supabase/functions/google-integration/tenant.ts`; never read `profiles.conta_id`.
  - Every route loads its `clientId` or location id with `conta_id = tenant` before any other work: 403 for a foreign client, as in `tiktok-analytics`, checked before plan flags.
  - Read functions are rate-limited at `checkRateLimit(db, "<fn>:<contaId>", 120, 60)`. Manual sync is `checkRateLimit(svc, "google-sync:<contaId>:<clientId>:<product>", 5, 300)`.
- **Gating (spec §4.5):**
  - Crons: product flag + `feature_auto_sync_cron`, and skip `fetchInternalWorkspaceIds`.
  - Read functions: product flag + `feature_analytics_reports`.
  - Manual sync: product flag.
  - Product flags are `feature_youtube` and `feature_google_business`.
- **History tables:**
  - `conta_id` is the first primary-key column, with no FK to the link tables.
  - `REVOKE ALL … FROM PUBLIC, anon, authenticated` plus `GRANT ALL … TO service_role`.
  - Every read, write and purge filters by `conta_id`.
- **Migrations:** versions `20261107000010`..`20261107000021`, leaving headroom above Phase 1's `…03`. Before `gh pr create`, re-check main's tail **and open PRs' migrations** (the #771 lesson) and renumber if anything collides.
- **Crons:**
  - Each cron has a `handler.ts` (`x-cron-secret` via `timingSafeEqual`, 401 before any DB access), a `core.ts` and an `index.ts`, as in `tiktok-sync-cron`.
  - `supabase/config.toml` `verify_jwt = false`.
  - Schedule migrations use the `vault.decrypted_secrets` subselect form (`20260720000007`).
  - **Deploy the function before its schedule migration.**
- **Spikes S2 and S3** need the user's Google project and are not tasks here. This plan builds these defaults:
  - **S2:** `is_short` = `creatorContentType = SHORTS` when the per-video report has it, else `duration_s <= 180`. If S2 shows the dimension is reliable, the fallback stays as dead code. If it shows the dimension is absent, the content-type split rows are simply never written, and the cards show "Dados até" per spec.
  - **S3:** GMN backfill tries 548, then 365, then 180 days and keeps the first window the API accepts. If S3 confirms 18 months, nothing changes.
- **Shared sync semantics** (Tasks 7-11 and 13 all rely on these; read them as part of every such task):
  - **Clocks:** YouTube "today"/"yesterday" are `America/Los_Angeles` dates (the Analytics API's Pacific days, stored as returned). GMN days and `gbp_rating_daily.day` are São Paulo dates (`saoPauloDate(now)`).
  - **Watermarks:** `data_through` = the last day the `all` channel report returned (YouTube) or per Task 8 step 1 (GMN), and it never moves backwards (`GREATEST(stored, computed)`). `content_type_through`, `traffic_through` and `videos_through` = `min(window end, data_through as set in this run)`, written only when that query succeeded (zero rows count as success). A card "lags" when its watermark `< data_through`.
  - **Windows:** `?days=N` → `[data_through - N + 1, data_through]`, previous = the N days before it. `?start&end` → `end` clipped to `data_through`; the previous window has the clipped length. `data_through` null → no KPIs (first-sync state).
  - **Write guard:** every per-unit write in a sync (history upserts, watermark and cache updates) first runs `UPDATE <unit> SET … WHERE id = ? AND <status> = 'active'` (or sits behind one in the same step). Zero rows updated means the unit was revoked or unlinked mid-run: stop with outcome `revoked` and write nothing else. This closes the race with `google_mark_revoked`'s purge (review C2).
  - **Outcomes, not failures:** `getFreshGoogleToken` `REVOKED` → `revoked`; `TOKEN_INVALID` or `NOT_FOUND` → `skipped` (one `console.error`, no `reportCronFailure`; the batch stamp rotates it to the back); `QUOTA_EXCEEDED` → `quota_skipped`; GMN `NOT_APPROVED` → `not_approved`. Only other thrown errors count as `failed` and reach `reportCronFailure`.
  - **Every history read, write and delete carries the unit's `conta_id`** (tests capture it via `createSupabaseQueryMock` `modifiers`).
- **Out of scope here:**
  - **Callback confirm step:** binding the callback to the initiating user (the session-confirm step raised by the push security review on #772) is pending the user's decision.
  - **Later phases:** Phase 3 (publishing) and Phase 4 (reports, including the layout edits to `youtube_purge_channel`).

## Rulings made while planning (each: decision, why, cost if wrong)

- **P1. Hourly crons, not one daily run.** YouTube runs at `35 * * * *` and GMN at `40 * * * *`. Both minutes are outside the stagger list (`20260925110001`; minutes ≡1,2 mod 5 are taken every 5 min). Each run claims rows with `last_synced_at` NULL or older than 20 h, ordered by `last_sync_attempt_at NULLS FIRST, id` (never by `data_through`, which would let never-syncable units starve the queue, as `instagram-sync-cron/select.ts` documents), pages until the batch fills with eligible units (the `collectSyncCandidates` shape), and stamps `last_sync_attempt_at` on **every candidate it looked at**, eligible or not, before any work.
  - **Why:** spec §5.1 asks for "daily, right after the Pacific reset", but one daily run of an unbounded batch cannot finish inside an edge invocation at scale. With a 20 h window, the order of syncs converges on the hours right after the reset anyway. Capacity is `24 × GOOGLE_SYNC_BATCH_LIMIT` units/day.
  - **If wrong:** two schedule strings to change. Known cost: once Phase 3 uploads share the Data API quota, a unit synced late in a quota day may end in `quota_skipped` and retry next hour.
- **P2. The Phase 2 purge omits report layout edits.** `youtube_purge_channel` deletes history rows, removes the `youtube` key from `report_documents.data_snapshot`, and clears and queues `pdf_storage_path` when that key was present. It filters by `(conta_id, client_id)`.
  - **Why:** layout block removal and `youtube_channel_id = NULL` are added in Phase 4, which re-creates the function. Before Phase 4 no layout can hold `youtube_*` blocks (`validate_report_layout()` rejects them) and the column does not exist.
  - **If wrong:** Phase 4 must not forget it, so Task 16 adds a CLAUDE.md line to that effect.
- **P3. What happens to a revoked channel row.** At purge the row's cached stats and avatar are nulled, and its watermarks (`data_through`, `content_type_through`, `traffic_through`, `videos_through`) are reset to NULL so a reconnect re-backfills. `title` and `handle` stay so the "Reconectar" card can name the channel. `google_expire_units()` calls `youtube_purge_channel` again (a backstop for anything written after the first purge) and then deletes the row, 30 days after `revoked_at`.
  - **Why:** spec §4.6 says non-analytics API data is refreshed or deleted within 30 days, and a revoked row cannot be refreshed.
  - **If wrong:** the agency sees "Conectar" instead of "Reconectar" after 30 days.
- **P4. Orphan sweep, one sub per call.** The sweep is `google_orphan_subs(p_limit)` (list only) plus `google_release_sub(p_sub)` (lock, then `_google_revoke_if_unused`). The cron loops subs one transaction each, so it never takes two sub locks in one transaction (final review minor 9).
  - **Deviation recorded:** spec §4.2 says a connection with no linked product "is kept with its tokens"; the sweep revokes a unit-less identity one hour after authorization when no workspace uses it (spec §4.2's own revoke rule, and the 100-token cap). Consequence: a GMN picker left open over an hour saves into `NOT_FOUND` and the user reconnects.
  - **If wrong:** raise the grace in `_google_revoke_if_unused` (one interval).
- **P5. Revocation retry.** Revocation processing is extracted from `google-integration/handlers.ts` (`processUnlinkDecision`) into `_shared/google-revocations.ts`, not copied. Retries stop after 10 attempts, logging an error and keeping the row for manual follow-up.
  - **If wrong:** a dead token never retried loses nothing; it is already invalid at Google or still counts toward the cap.
- **P6. New error code `QUOTA_EXCEEDED`.** It is added to `GoogleApiError` for 403 `reason` `quotaExceeded`/`dailyLimitExceeded` (YouTube Data API). A quota-0 403 stays `NOT_APPROVED`. Sync treats both as "skip that step today", never as a revoke or a cron failure.
  - **If wrong:** one mapping line.
- **P7. Backfill is resumable, not a separate job.** A unit with `data_through IS NULL` is claimed first and synced with the backfill window (YouTube channel reports 365 days, GMN per S3 above). Per-video daily reports are capped at `MAX_VIDEO_REPORTS_PER_RUN = 40` per channel per run and resume through `youtube_videos.daily_through`. The connect callback triggers nothing; the tab shows a "Primeira sincronização em andamento" state until `data_through` is set.
  - **If wrong:** first data lags up to one cron hour.
- **P8. Per-video engaged views.** `youtube_video_daily` also stores `engaged_views`, because mockup 3's video table has an "Engajadas" column that spec §5.1's per-video list omits.
  - **If wrong:** one nullable column.
- **P9. Phone layouts and states.** Neither mockup has a phone variant or a not-connected, expired or empty state. Both tabs follow the TikTok tab's phone pattern and states. `StateCard`, `LoadingCard` and `LockedCard` are extracted from `TikTokAnalyticsTab.tsx` to `pages/analytics-conta/AnalyticsStateCards.tsx` and re-imported there.
  - **If wrong:** visual tweaks.
- **P10. Wording of the YouTube footer.** It is kept for attribution (§4.6): "Dados do YouTube, como o YouTube informa." The AI sentence is dropped: spec §3 makes no AI a non-goal, so the page should not advertise its absence.
  - **If wrong:** one string.
- **P11. Relinking a client to a different YouTube channel is an unlink first.** When the callback finds the client already linked to another `channel_id`, it calls `google_unlink_youtube` (purge, revoke decision, row delete) before inserting the new channel, so no history is orphaned and the new channel backfills from NULL watermarks. Same `channel_id` on a new connection keeps history and only releases the old sub.
  - **Why:** review C1: the Phase 1 upsert on `client_id` would orphan the old channel's history (a retention breach) and hand its watermarks to the new channel.
  - **If wrong:** none; this is the policy reading.
- **P12. Phase 1 ruling R12 stands.** A GMN unit never moves between connections through the picker (it filters units held through another connection), so only the YouTube relink releases an old sub.

## Review Focus

1. **Quota and approval errors.** A Data API `quotaExceeded`, or GMN `NOT_APPROVED`, during the cron must skip that step for the day, leave every unit and connection `active`, and not call `reportCronFailure`. Pinned in Tasks 7 and 8.
2. **`invalid_grant` in mid-batch.** It must purge every YouTube channel on that connection at once, flip its GMN units to `revoked` (history kept), and count the other units on the same connection as skipped, not failed. One connection must not produce N cron failures. Pinned in Tasks 3 and 7.
3. **The same channel or location in two workspaces.** A purge, expiry or sync write in one workspace must leave the other's history untouched. Pinned in Task 3 (SQL) and Tasks 7-8 (every write keyed by `conta_id`).
4. **Sparse and empty data.** A channel with no Shorts shows zeros on the split cards, not "sem dados". A GMN day the API omits up to `data_through` is stored as 0, and days after `data_through` are never written. KPI windows end at `data_through`, not today. Pinned in Tasks 7, 8, 10 and 11.
5. **Reconnecting.** Reconnecting within 30 days reactivates GMN units with history intact. After 30 days the unit and its history are gone. A reconnected YouTube channel re-backfills, because the purge reset its watermarks. Pinned in Tasks 3 and 7.

---

### Task 1: YouTube history tables

**Files:**
- Create: `supabase/migrations/20261107000010_youtube_history.sql`
- Test: `supabase/tests/entitlements/99_youtube_history.sql`

**Interfaces:**
- Produces:
  - Tables `youtube_channel_daily`, `youtube_traffic_daily`, `youtube_demographics`, `youtube_videos`, `youtube_video_daily` and `youtube_pdf_purges`, with the columns of spec §5.1, plus `youtube_video_daily.engaged_views bigint` (P8) and `youtube_videos.daily_through date`.
  - Column names shared by Tasks 7 and 10: `youtube_channel_daily` metrics `views, engaged_views, estimated_minutes_watched, likes, comments, shares, subscribers_gained, subscribers_lost, average_view_duration_s`, all **nullable** (Google leaves some unsplit on split rows); `youtube_videos` `title, published_at, duration_s, is_short, thumbnail_url, view_count, like_count, comment_count, metadata_refreshed_at, daily_through`; `youtube_video_daily` `views, engaged_views, likes, comments, shares, subscribers_gained, average_view_duration_s, average_view_percentage`; `youtube_traffic_daily.views`; `youtube_demographics.viewer_pct numeric`.
  - `youtube_pdf_purges(id uuid PK, conta_id, client_id bigint, storage_path text NOT NULL, attempts int DEFAULT 0, created_at)`.
  - New columns `last_sync_attempt_at timestamptz` on `youtube_channels` and on `gbp_locations`.
  - Primary keys:
    - `youtube_channel_daily (conta_id, channel_id, day, content_type)`, where `content_type` has a CHECK on `('all','shorts','long','live')`.
    - `youtube_traffic_daily (conta_id, channel_id, day, source_type)`.
    - `youtube_demographics (conta_id, channel_id, window_end, age_group, gender)`.
    - `youtube_videos (conta_id, channel_id, video_id)`.
    - `youtube_video_daily (conta_id, channel_id, video_id, day)`.

- [ ] **Step 1: Write the failing SQL test** (`\i _helpers.sql`, `begin; … rollback;` blocks). It asserts:
  - **Privileges:** `has_table_privilege` is false for `anon` and `authenticated` on all six tables, and true for `service_role`. Use `p_exclude` with `et_grant_hosted_parity()` or skip it, per Phase 1 ruling R1.
  - **Workspace isolation:** two workspaces can insert the same `(channel_id, day, 'all')` row without conflict.
  - **Validation:** the `content_type` CHECK rejects `'reels'`.
  - **New columns:** both `last_sync_attempt_at` columns exist.
- [ ] **Step 2: Run** `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_youtube_history.sql`. Expected: FAIL, relation does not exist.
- [ ] **Step 3: Write the migration.** Include a header comment citing spec §5.1 and P8, then `SET LOCAL lock_timeout = '5s'`, `CREATE TABLE IF NOT EXISTS`, RLS enabled, and the REVOKE/GRANT pair from Global Constraints.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(youtube): history tables and PDF purge queue`.

### Task 2: GMN history tables

**Files:**
- Create: `supabase/migrations/20261107000011_gbp_history.sql`
- Test: `supabase/tests/entitlements/99_gbp_history.sql`

**Interfaces:**
- Produces:
  - `gbp_metrics_daily (conta_id, location_name, day)` with the ten metric columns of spec §5.2 as `int NOT NULL DEFAULT 0`, named in lower snake case (`business_impressions_desktop_maps`, …, `business_food_menu_clicks`).
  - `gbp_search_keywords_monthly (conta_id, location_name, month date, keyword)` with `value int` and `threshold int`, plus a CHECK that exactly one of the two is non-null.
  - `gbp_reviews (conta_id, location_name, review_id)` with `reviewer_name` (nullable: anonymous reviewers), `star_rating smallint CHECK 1..5`, `comment`, `create_time`, `update_time` and `has_reply`.
  - `gbp_rating_daily (conta_id, location_name, day)` with `average_rating numeric(2,1)` and `total_review_count int`; `day` is the São Paulo date of the sync.
  - New column `gbp_locations.maps_uri text`, from Business Information `metadata.mapsUri`. Every "Abrir no Google" link points there.

- [ ] **Step 1: Write the failing SQL test.** It covers:
  - the same privilege asserts as Task 1;
  - the keyword CHECK rejecting both values null and both values set;
  - the `star_rating` CHECK rejecting 0 and 6;
  - two workspaces sharing a `location_name` without conflict.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gbp): history tables`.

### Task 3: Purge, expiry and release RPCs

**Files:**
- Create: `supabase/migrations/20261107000012_google_purge_rpcs.sql`
- Test: `supabase/tests/entitlements/99_google_purge_rpcs.sql`

**Interfaces:**
- Consumes: Tasks 1-2 tables; the Phase 1 functions `_google_revoke_if_unused(text)`, `google_unlink_youtube(uuid, bigint)` and `google_mark_revoked(uuid)` (`20261108000003`).
- Produces (all SECURITY DEFINER, `SET search_path = public, pg_temp`, EXECUTE for `service_role` only):
  - `youtube_purge_channel(p_conta_id uuid, p_channel_id text, p_client_id bigint) RETURNS int`. It returns the count of PDF paths queued and deletes:
    - every `youtube_*` history row for `(conta_id, channel_id)`;
    - in `report_documents` for `(conta_id, client_id)`: `data_snapshot - 'youtube'`. Where that key was present and `pdf_storage_path` is set, it queues a `youtube_pdf_purges` row and nulls `pdf_storage_path` and `pdf_generated_at` (P2).
    - It also writes an `audit_log` row (`action 'youtube-data-purged'`, `resource_type 'youtube_channel'`).
  - `google_unlink_youtube` is re-created with the same signature and return. It purges with the values its locked `DELETE … RETURNING connection_id, channel_id` returned (never values read before the lock, per the Phase 1 stale-relink comment).
  - Every purge delete is bounded by a PK prefix `(conta_id, channel_id, …)`, so it stays fast inside `google_mark_revoked`, which runs while `getFreshGoogleToken` holds `refresh_lock_at`.
  - `google_mark_revoked` is re-created with the same signature. It purges every channel of that connection that it flips to `revoked`, then nulls their cached stats, avatar and watermarks (P3). It still never touches `refresh_lock_at` and stays idempotent: a second call purges nothing new.
  - `google_expire_units() RETURNS TABLE(gbp_locations_deleted int, youtube_channels_deleted int)`.
    - **GMN:** for `gbp_locations` with `status IN ('disconnected','revoked') AND disconnected_at < now() - interval '30 days'`, it deletes that location's history in all four GMN tables (keyed by its own `conta_id`), then the row.
    - **YouTube:** for `youtube_channels` with `authorization_status = 'revoked' AND revoked_at < now() - interval '30 days'`, it calls `youtube_purge_channel` (backstop, P3) and then deletes the row.
    - It runs without the sub lock on purpose: a missed revoke is repaired by the next orphan sweep, and a reconnect racing an expiry re-inserts the channel in the callback (review M1).
  - `google_orphan_subs(p_limit int) RETURNS SETOF text`. It lists distinct subs that are not in use, using the in-use test of `_google_revoke_if_unused` (no grace connection, no channel, no active or revoked unit), limited to `p_limit` and read-only.
  - `google_release_sub(p_sub text) RETURNS TABLE(should_revoke boolean, revocation_id uuid)`. It takes the `google-sub:` advisory lock, then returns `_google_revoke_if_unused(p_sub)`.

- [ ] **Step 1: Write the failing SQL test**, one `begin; … rollback;` block per case, seeding through the existing `et_*` helpers plus direct inserts as `postgres`:
  - `purge_deletes_only_own_workspace`: workspaces A and B both link channel `UCx`, with history rows in both. Purging A leaves B's rows untouched.
  - `purge_strips_snapshot_and_queues_pdf`: a report with `data_snapshot` holding a `youtube` key and a PDF path. After purge the key is gone, the path is null, and one `youtube_pdf_purges` row exists. A report without the key keeps its PDF.
  - `unlink_youtube_purges`: the channel history is gone after `google_unlink_youtube`.
  - `mark_revoked_purges_and_resets`: history is gone, stats, avatar and watermarks are null, title is kept, and `refresh_lock_at` is unchanged. A second call is a no-op.
  - `expire_units_30_days`: a unit disconnected 31 days ago is deleted with its history. One disconnected 29 days ago stays. A YouTube channel revoked 31 days ago that still has history rows (written after the first purge) is deleted **with** them.
  - `expire_units_cross_workspace`: workspace B links the same `location_name` and `channel_id` and keeps all its rows when A's expire.
  - `mark_revoked_whole_connection`: two channels and one GMN unit on one connection. Both channels are purged; the unit becomes `revoked` with its `gbp_*` history intact.
  - `reconnect_within_30_days_keeps_gmn_history`: after `google_mark_revoked` then `google_connection_upsert` with `business.manage`, the unit is `active` and its history rows remain.
  - `orphan_subs_respects_grace_and_units`: a sub authorized 2 h ago with no units is listed. One authorized 10 min ago is not. One with an active unit is not.
  - `release_sub_revokes_once`: calling `google_release_sub` twice yields `(true, id)` then `(false, NULL)`, with exactly one `google_revocations` row.
- [ ] **Step 2: Run it.** Expected: FAIL, function does not exist.
- [ ] **Step 3: Write the migration.** Copy the Phase 1 bodies of the two re-created functions verbatim and add only the purge calls. Re-state the REVOKE/GRANT lines for every function.
- [ ] **Step 4: Run** this test, then `99_google_connection_rpcs.sql` and `99_google_connections.sql`. Expected: all PASS; the Phase 1 suites are unchanged.
- [ ] **Step 5: Commit** `feat(google): purge, 30-day expiry and orphan release RPCs`.

### Task 4: Shared Google plumbing (quota code, revocations, PDF purges)

**Files:**
- Modify: `supabase/functions/_shared/google.ts` (add `QUOTA_EXCEEDED` to `GoogleApiErrorCode` and map to it, retryable `false`, a 403 whose `errors[].reason` is `quotaExceeded` or `dailyLimitExceeded`, or a 403/429 whose `error.status` is `RESOURCE_EXHAUSTED` or whose `details[].reason` is `QUOTA_EXCEEDED` (the Analytics API's google.rpc shape); checked after quota-zero, which stays `NOT_APPROVED`, and before `RATE_LIMITED`/`FORBIDDEN`)
- Create: `supabase/functions/_shared/google-revocations.ts`
- Create: `supabase/functions/_shared/youtube-pdf-purges.ts`
- Modify: `supabase/functions/google-integration/handlers.ts` (`processUnlinkDecision` becomes a call to `processRevocation`)
- Test: `supabase/functions/__tests__/google-shared_test.ts` (extend), `supabase/functions/__tests__/google-revocations_test.ts`, `supabase/functions/__tests__/youtube-pdf-purges_test.ts`

**Interfaces:**
- Produces:
  - `processRevocation(svc: DbClient, revocationId: string, deps?: { revoke?: typeof revokeGoogleToken }): Promise<"revoked" | "failed" | "missing">`. This is today's `processUnlinkDecision` body.
  - `retryPendingRevocations(svc, opts: { limit: number; maxAttempts: number; revoke? }): Promise<{ revoked: number; failed: number; gaveUp: number }>`. It selects rows ordered by `created_at` with `attempts < maxAttempts`, and logs `console.error` once per row reaching `maxAttempts`.
  - `processUnlinkDecisionData(svc, rpcData: unknown): Promise<void>`. It reads `(should_revoke, revocation_id)` from the RPC data and calls `processRevocation`.
  - `drainYoutubePdfPurges(svc, opts: { storage: StorageLike; contaId?: string; limit: number; maxAttempts: number }): Promise<{ removed: number; failed: number; gaveUp: number }>`. It removes from bucket `analytics-reports` (`PDF_BUCKET`, `report-docs/errors.ts`), deletes the row on success (an already-missing object counts as success), and increments `attempts` on failure; rows at `maxAttempts` (10) are skipped and logged once, like revocations.

- [ ] **Step 1: Write failing tests.** They cover:
  - `mapGoogleError` mapping a 403 `quotaExceeded` body to `QUOTA_EXCEEDED`, and a quota-zero 403 still mapping to `NOT_APPROVED`;
  - `processRevocation` deleting the row on success, incrementing `attempts` and `last_error` on failure, and returning `"missing"` for an unknown id;
  - `retryPendingRevocations` skipping rows at `maxAttempts` and counting `gaveUp`;
  - `drainYoutubePdfPurges` filtering by `conta_id` when one is given.
- [ ] **Step 2: Run** `deno test --no-check --allow-env --allow-net --allow-read` on the three files. Expected: FAIL.
- [ ] **Step 3: Implement it.** Move the body; do not duplicate it. `google-integration` keeps its behaviour, and its existing route tests must pass untouched.
- [ ] **Step 4: Run** the three files plus `google-integration-routes_test.ts`, then `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(google): shared revocation processing, quota code, PDF purge drain`.

### Task 5: YouTube API client

**Files:**
- Create: `supabase/functions/_shared/youtube-api.ts`
- Test: `supabase/functions/__tests__/youtube-api_test.ts`

**Interfaces:**
- Consumes: `googleFetch(url, token, init)` from `_shared/google.ts`.
- Produces (each takes an injected `fetchJson = googleFetch` for tests; bases `https://www.googleapis.com/youtube/v3` and `https://youtubeanalytics.googleapis.com/v2/reports`):
  - `getMyChannel(token): Promise<YtChannel | null>`, where `YtChannel = { id, title, handle, avatarUrl, uploadsPlaylistId, subscriberCount, viewCount, videoCount }`.
  - `listUploads(token, playlistId, opts: { pageToken?: string }): Promise<{ videoIds: string[]; nextPageToken: string | null }>`. Each page requests `maxResults=50`.
  - `getVideos(token, ids: string[]): Promise<YtVideo[]>`. It takes at most 50 ids, with parts `snippet,contentDetails,statistics`. `durationS` is parsed from ISO 8601, and `YtVideo.isShortByDuration = durationS <= 180`.
  - `channelDaily(token, range: { start: string; end: string }, byContentType: boolean): Promise<YtChannelDailyRow[]>`. It uses `ids=channel==MINE` and `dimensions=day` or `day,creatorContentType`, and requests `views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost,averageViewDuration`. `creatorContentType` maps to `shorts`, `long` or `live` (`SHORTS`, `VIDEO_ON_DEMAND`, `LIVE_STREAM`); unknown values are dropped.
  - `trafficDaily(token, range)`, using `dimensions=day,insightTrafficSourceType` and `metrics=views`.
  - `demographics(token, range)`, using `dimensions=ageGroup,gender` and `metrics=viewerPercentage`.
  - `videoDaily(token, videoId, range)`, using `filters=video==<id>`, `dimensions=day` and `metrics=views,engagedViews,likes,comments,shares,subscribersGained,averageViewDuration,averageViewPercentage`.
  - `videoContentTypes(token, range)`: the Top videos report, `dimensions=video,creatorContentType&metrics=views&sort=-views&maxResults=200` over `range` (`startDate` 2019-01-01 or the channel's first upload, `endDate` yesterday), **no `video==` filter** (that report does not accept one). Returns `Map<videoId, 'shorts' | 'long' | 'live'>`; it only classifies the top 200 videos by views, and ids absent from it fall back to duration. Best-effort: `null` on a 400 (the S2 default).
  - Analytics rows are parsed by `columnHeaders` name, never by position.

- [ ] **Step 1: Write failing tests** with a fake `fetchJson` asserting URLs and parsing:
  - a `columnHeaders`-order shuffle still parses correctly;
  - `PT1M5S` parses to 65;
  - an unknown content type is dropped;
  - `getMyChannel` returns `null` on empty `items`;
  - the `videoContentTypes` URL carries `sort=-views` and `maxResults=200` and no `filters`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(youtube): Data and Analytics API client`.

### Task 6: GMN API client

**Files:**
- Create: `supabase/functions/_shared/gbp-api.ts`
- Test: `supabase/functions/__tests__/gbp-api_test.ts`

**Interfaces:**
- Produces (same injected `fetchJson`):
  - `fetchDailyMetrics(token, locationName, range: { start: string; end: string }): Promise<Map<string, GbpDayMetrics>>`. It calls `GET https://businessprofileperformance.googleapis.com/v1/{location}:fetchMultiDailyMetricsTimeSeries` with every `dailyMetrics` from spec §5.2 and `dailyRange.*`, keyed by ISO day. Missing values become 0.
  - `fetchMonthlyKeywords(token, locationName, month: string)` (`YYYY-MM`), calling `…/{location}/searchkeywords/impressions/monthly` with `monthlyRange.start_month` = `monthlyRange.end_month` = that month and `pageSize=100`, following `pageToken`. **One call per month**: over a multi-month range Google sums the months into one number. Returns `{ month, keyword, value | threshold }[]`, where `insightsValue.value` maps to `value` and `insightsValue.threshold` to `threshold` (int64 strings parsed to numbers).
  - Query-string ranges use snake_case (`dailyRange.start_date.year` etc.).
  - Field names not re-verified against a live response (`TimeSeries.datedValues[].{date:{year,month,day},value}` with `value` absent for zero; review `reviewId`, `reviewer.displayName`, `starRating`, `comment`, `createTime`, `updateTime`, `reviewReply`): build the test fixtures from the documented resources and treat a mismatch found in staging as a fixture fix.
  - `listReviews(token, accountName, locationName, opts: { pageToken?: string })`, calling `https://mybusiness.googleapis.com/v4/{account}/{location}/reviews?orderBy=updateTime desc&pageSize=50`. It returns `{ reviews: GbpReview[]; averageRating: number | null; totalReviewCount: number | null; nextPageToken }`, mapping `starRating` `ONE`..`FIVE` to 1..5 and setting `hasReply = !!reviewReply`.
  - `getLocation(token, locationName)`, calling `https://mybusinessbusinessinformation.googleapis.com/v1/{location}?readMask=title,metadata`. It returns `{ title, hasVoiceOfMerchant, mapsUri }`, where `mapsUri` comes from `metadata.mapsUri`.

- [ ] **Step 1: Write failing tests:**
  - a metrics response with a missing day yields that day as 0 for every metric;
  - a threshold keyword parses to `threshold`;
  - `starRating` `FOUR` parses to 4;
  - pagination follows `nextPageToken`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gbp): Performance, keywords, reviews and location client`.

### Task 7: YouTube sync (shared unit sync + `youtube-sync-cron`)

**Files:**
- Create: `supabase/functions/_shared/youtube-sync.ts`
- Create: `supabase/functions/youtube-sync-cron/{index,handler,core}.ts`
- Create: `supabase/migrations/20261107000020_youtube_sync_cron_schedule.sql` (`youtube-sync-cron`, `35 * * * *`)
- Modify: `supabase/config.toml` (`[functions.youtube-sync-cron] verify_jwt = false`)
- Test: `supabase/functions/__tests__/youtube-sync_test.ts`, `supabase/functions/__tests__/youtube-sync-cron_test.ts`

**Interfaces:**
- Consumes:
  - from Task 5, the YouTube API client;
  - from Task 4, `drainYoutubePdfPurges` and `QUOTA_EXCEEDED`;
  - `getFreshGoogleToken`;
  - `runPool` from `../instagram-sync-cron/pool.ts`, imported by path the way TikTok does;
  - `effectivePlanFeature` and `fetchInternalWorkspaceIds`;
  - `reportCronFailure`.
- Produces:
  - `syncYouTubeChannel(deps: YoutubeSyncDeps, channel: YoutubeChannelRow, opts: { now: Date; maxVideoReports: number }): Promise<YoutubeSyncOutcome>`.
    - `YoutubeChannelRow` holds the `youtube_channels` columns without tokens.
    - `YoutubeSyncOutcome` is `{ status: "synced" | "revoked" | "quota_skipped" | "skipped" | "mismatch"; backfill: boolean }`.
    - `YoutubeSyncDeps = { svc; api: typeof import('./youtube-api.ts'); getFreshGoogleToken; now: () => Date }` (Task 9 builds one).
  - `runYouTubeSyncCron(deps): Promise<Response>`.
  - `createYouTubeSyncCronHandler({ cronSecret, run, timingSafeEqual })`.

The per-channel steps run in order, each persisting before the next call:

1. **Token.** Call `getFreshGoogleToken`. On `REVOKED` (the RPC already purged), return `revoked`.
2. **Channel counts.** Call `getMyChannel` and update the cached counts, `title`, `handle` and `avatar_url` (§4.6 30-day refresh). If the returned id differs from `channel_id`, log it and return outcome `mismatch` (counted as skipped; it does **not** mark the connection seen-revoked, so sibling channels still sync).
3. **Videos.**
   - Page through the uploads playlist until a known `video_id` is seen. A backfill stops at 1,000 ids.
   - Call `getVideos` for new ids, plus every stored video published in the last 90 days, the 200 most recent, and the rotating batch whose `metadata_refreshed_at` is older than 25 days. Upsert these.
   - Delete only ids **requested in this run** that `getVideos` did not return, with their `youtube_video_daily` rows.
   - `is_short` comes from `videoContentTypes` (refreshed at most once a day per channel), falling back to duration.
4. **Analytics.**
   - The window is `[data_through - 7, yesterday]`, or `[today - 365, yesterday]` when `data_through` is null; Pacific dates are stored as returned.
   - Fetch `channelDaily` (all) and set `data_through` to the last returned day. A window with no rows keeps the previous value.
   - Fetch `channelDaily` by content type and set `content_type_through` on a successful call, even with zero rows. Do the same for `trafficDaily` and `traffic_through`.
   - Fetch `demographics` for the last 28 days and **replace** the channel's snapshot (delete its rows, insert the new `window_end`), so the table holds one snapshot per channel.
   - Fetch `videoDaily` for videos published in the last 90 days whose `daily_through` lags, up to `maxVideoReports` (P7), advancing each `daily_through`. Set `videos_through` when none lag.
5. **Finish.** Set `last_synced_at = now`.
6. **Quota.** `QUOTA_EXCEEDED` in steps 2-3 skips to step 4. In step 4 it stops the remaining Analytics calls. Either way return `quota_skipped`, without `last_synced_at`, so the next hour retries.

The cron core works as follows:
- **Candidates (P1):** `youtube_channels` with `authorization_status = 'active'` and `last_synced_at` null or older than 20 h, ordered `last_sync_attempt_at NULLS FIRST, id`, paged (200 per page, at most 10 pages) until `GOOGLE_SYNC_BATCH_LIMIT` (default 25) eligible units are found.
- **Eligibility:** every workspace needs `feature_youtube` AND `feature_auto_sync_cron` and must not be internal (one flag lookup per workspace).
- **Stamp:** stamp `last_sync_attempt_at` on every candidate examined (eligible or not) before any work; a failed stamp is logged.
- **Pool:** run `runPool(GOOGLE_SYNC_CONCURRENCY` (default 4)`)`. The callback swallows its own errors, and a channel on a connection already seen `revoked` in this run is skipped.
- **Failures:** per the shared outcome rules in Global Constraints; only `failed` reaches `reportCronFailure`.
- **Then:** `drainYoutubePdfPurges({ limit: 50 })`.
- **Response:** `{ success, synced, revoked, quotaSkipped, skipped, failed, total }`.

- [ ] **Step 1: Write failing tests** with `createSupabaseQueryMock` and fake API deps, where every unused dependency throws "must not be called":
  - **Handler:** a missing or bad secret returns 401 with zero DB calls.
  - **Flags:** a workspace without `feature_auto_sync_cron` is skipped, and so is an internal workspace.
  - **Batch stamp:** the stamp precedes every API call.
  - **Backfill:** with null `data_through`, the window starts 365 days back.
  - **No Shorts:** a successful content-type call with zero rows still sets `content_type_through`.
  - **Quota (Review Focus 1):** `QUOTA_EXCEEDED` on `getMyChannel` gives `quota_skipped`, no `reportCronFailure`, and no status write.
  - **Revoked (Review Focus 2):** `REVOKED` on channel 1 of a connection causes channel 2 on the same connection to be skipped without a token call, with no failure report.
  - **Cleanup:** a video missing from `getVideos` is deleted together with its daily rows.
  - **Video cap:** with 41 lagging videos, 40 reports run and one waits.
  - **Mid-run revoke (C2):** the channel's status flips to `revoked` after the token fetch; the guarded update returns 0 rows, no history row is written, the outcome is `revoked`.
  - **Starvation (I1):** 26 ineligible candidates ahead of one eligible channel; the eligible one still syncs and all 27 are stamped.
  - **Token without refresh (I2):** `TOKEN_INVALID` gives `skipped`, no `reportCronFailure`.
  - **Mismatch:** a channel-id mismatch on channel 1 does not skip channel 2 on the same connection.
  - **Quota mid-analytics (Review Focus 1):** `QUOTA_EXCEEDED` after a successful `channelDaily` keeps the advanced `data_through`, leaves `traffic_through` untouched and returns `quota_skipped` without `last_synced_at`.
  - **Tenant keys (Review Focus 3):** every history upsert and delete carries the channel's `conta_id`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `_shared/youtube-sync.ts`, then the cron trio. `index.ts` throws if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` is missing.
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Write the schedule migration** (idempotent unschedule then `cron.schedule`; header comment: "deploy youtube-sync-cron BEFORE applying").
- [ ] **Step 6: Commit** `feat(youtube): channel sync and hourly youtube-sync-cron`.

### Task 8: GMN sync (shared unit sync + `gbp-sync-cron` with deletion duties)

**Files:**
- Create: `supabase/functions/_shared/gbp-sync.ts`
- Create: `supabase/functions/gbp-sync-cron/{index,handler,core}.ts`
- Create: `supabase/migrations/20261107000021_gbp_sync_cron_schedule.sql` (`gbp-sync-cron`, `40 * * * *`)
- Modify: `supabase/config.toml` (`[functions.gbp-sync-cron] verify_jwt = false`)
- Test: `supabase/functions/__tests__/gbp-sync_test.ts`, `supabase/functions/__tests__/gbp-sync-cron_test.ts`

**Interfaces:**
- Consumes:
  - from Task 6, the GMN API client;
  - from Task 3, `google_expire_units`, `google_orphan_subs` and `google_release_sub`;
  - from Task 4, `retryPendingRevocations` and `processUnlinkDecisionData`;
  - `getFreshGoogleToken`, `runPool`, the flag helpers and `reportCronFailure`.
- Produces:
  - `syncGbpLocation(deps: GbpSyncDeps, location: GbpLocationRow, opts: { now: Date }): Promise<{ status: "synced" | "revoked" | "not_approved" | "skipped"; backfill: boolean }>`, with `GbpSyncDeps = { svc; api: typeof import('./gbp-api.ts'); getFreshGoogleToken; now: () => Date; sleep: (ms: number) => Promise<void> }`.
  - The write guard and outcome rules of Global Constraints apply (status `active` on `gbp_locations`).
  - `runGbpSyncCron(deps): Promise<Response>`.
  - `createGbpSyncCronHandler(...)`.

The per-location steps follow spec §5.2:

1. **Daily metrics.**
   - The window is `[data_through - 7, yesterday]`.
   - A backfill tries 548, then 365, then 180 days (S3 default). It treats a 400 `UPSTREAM` as "range not allowed" and tries the next length.
   - `computed` = the latest day with any metric, minus 2 days; if the call succeeded with no dated values (a dormant location), `computed` = yesterday − 2. `data_through = GREATEST(stored, computed)`; it never regresses (review I4).
   - Write every day of the window up to `data_through` (0 for days the API omitted). Never write a day after it.
2. **Keywords.** One `fetchMonthlyKeywords` call per closed month: the last 2 (backfill: 18), upserting each month's rows.
3. **Reviews.**
   - Page newest first until a known `review_id` with an unchanged `update_time` appears, or 200 rows are reached.
   - Upsert the reviews and prune rows beyond the newest 200.
   - Upsert today's `gbp_rating_daily` from the response totals, and update the cached `average_rating` and `total_review_count` on the row.
4. **Location refresh.** Refresh `title`, `has_voice_of_merchant` and `maps_uri`.
5. **Finish.** Set `last_synced_at = now`.
6. **Errors.**
   - `NOT_APPROVED` returns `not_approved` with no writes.
   - `RATE_LIMITED` retries 3 times with backoff of 1 s, 2 s and 4 s, using the injected `sleep`, then throws.

The cron core does two things.
- **Sync batch:** the same claim, page-until-full, stamp-every-candidate and flag pattern as Task 7, with `feature_google_business` and `GOOGLE_SYNC_BATCH_LIMIT`. Locations have `status = 'active'`, a non-null `connection_id`, and `last_synced_at` null or older than 20 h. `GOOGLE_SYNC_CONCURRENCY` is capped at 4, because 4 locations × ~4 calls stays far under 300 QPM.
- **Deletion duties:** these run after the batch, each in its own try/catch, and **regardless of flags** (privacy duties):
  - `google_expire_units()`;
  - `retryPendingRevocations({ limit: 50, maxAttempts: 10 })`;
  - `google_orphan_subs(25)`, then, for each sub, `google_release_sub(sub)` followed by `processUnlinkDecisionData`.
- **Response:** `{ success, synced, revoked, notApproved, failed, total, expired: {...}, revocations: {...}, orphansReleased }`.

- [ ] **Step 1: Write failing tests:**
  - **Handler:** returns 401 with no DB calls.
  - **Omitted days (Review Focus 4):** an omitted day is written as zeros, and a day after `data_through` is not written.
  - **Backfill fallback:** a 400 on 548 days falls back to 365.
  - **Reviews:** the walk stops at a known unchanged review, and rows beyond the newest 200 are pruned.
  - **Not approved (Review Focus 1):** `NOT_APPROVED` gives no failure report and no writes.
  - **Duties without flags:** with every flag off, the deletion duties still run.
  - **Orphans:** two subs yield two separate `google_release_sub` calls, one per sub.
  - **Isolation:** a duty failure does not stop the other duties.
  - **Dormant location (I4):** an empty successful response keeps or advances `data_through`, never moves it back.
  - **Keywords per month (I9):** a 2-month refresh makes two calls with `start_month = end_month`.
  - **Starvation and `TOKEN_INVALID`:** as in Task 7.
  - **Tenant keys (Review Focus 3):** every `gbp_*` write carries the location's `conta_id`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Write the schedule migration** (header: deploy `gbp-sync-cron` BEFORE applying).
- [ ] **Step 6: Commit** `feat(gbp): location sync and hourly gbp-sync-cron with deletion duties`.

### Task 9: `google-integration`: manual sync and Phase 1 gaps

**Files:**
- Modify: `supabase/functions/google-integration/handlers.ts`
- Test: `supabase/functions/__tests__/google-integration-routes_test.ts` (extend), `supabase/functions/__tests__/google-integration-callback_test.ts` (extend)

**Interfaces:**
- Consumes: from Tasks 7 and 8, `syncYouTubeChannel` and `syncGbpLocation`; from Tasks 3 and 4, `google_release_sub`, `processUnlinkDecisionData` and `drainYoutubePdfPurges`.
- Produces:
  - **Manual sync:** `POST /sync/youtube/:clientId` and `POST /sync/gbp/:clientId`, returning `{ ok: true, status }`. For GMN, `status` is per location, as `{ ok: true, locations: [{ id, status }] }`.
    - The order is: client in tenant, product flag (403 `feature_disabled`), rate limit (429), then the unit lookup.
    - A missing unit returns 404 `not_connected`; a revoked unit returns 409 `revoked`.
    - The unit sync runs with `maxVideoReports: 40`. GMN syncs only that client's active locations, sequentially.
  - **Disconnect:** `POST /disconnect/youtube/:clientId` also calls `drainYoutubePdfPurges({ contaId })` after the RPC commits.
  - **Unit-picker save** (`handleLinkLocations`): the unlink set includes this client's `revoked` rows as well as `active` ones. When `getFreshGoogleToken` throws `REVOKED` (the connection itself is dead) and the save's `locationNames` is empty, skip the Google listing and run only the unlink loop over this client's `active` + `revoked` rows on that connection, instead of answering 409 (review I3). The save also stores `maps_uri` from the listing's `metadata` (Phase 1 `locations.ts` already reads it), so "Abrir no Google" works before the first sync.
  - **YouTube relink (P11):** in the callback, before `linkYouTubeChannel`:
    - stored row with a **different `channel_id`**: call `google_unlink_youtube(conta, client)`, then `processUnlinkDecisionData` and `drainYoutubePdfPurges({ contaId })`, then insert the new channel (NULL watermarks, so it backfills);
    - same `channel_id` on a **different connection**: capture the old connection's `google_sub` before the write; after it, `google_release_sub(oldSub)` then `processUnlinkDecisionData`.
  - GMN units never move between connections through the picker (P12).

- [ ] **Step 1: Write failing tests:**
  - **Sync order:** sync on a foreign client returns 403 before any flag read; flag off returns 403 `feature_disabled`; the sixth call returns 429; a revoked unit returns 409.
  - **Revoked unlink:** saving with a revoked unit unchecked unlinks it.
  - **Different channel (C1):** relinking client X from channel `UCa` to `UCb` calls `google_unlink_youtube` once (purge + one revoke decision for sub A) before the insert, and the new row has NULL watermarks.
  - **Same channel, new account:** relinking `UCa` under sub B calls `google_release_sub` with sub A exactly once; relinking under the same sub does not call it.
  - **Dead connection unlink (I3):** a revoked connection with an empty save unlinks the client's revoked units without calling Google.
  - **PDF drain:** disconnect drains PDF purges for the tenant only.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** both suites, plus `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): manual sync routes; release old account on relink; unlink revoked units`.

### Task 10: `youtube-analytics` read function

**Files:**
- Create: `supabase/functions/_shared/youtube-analytics/{window,queries,kpis}.ts`
- Create: `supabase/functions/youtube-analytics/{index,handlers}.ts`
- Modify: `supabase/config.toml` (`[functions.youtube-analytics] verify_jwt = false`)
- Test: `supabase/functions/_shared/youtube-analytics/kpis.test.ts`, `supabase/functions/_shared/youtube-analytics/window.test.ts`, `supabase/functions/__tests__/youtube-analytics_test.ts`

**Interfaces:**
- Consumes: Task 1 tables; `google-integration/tenant.ts`; `checkRateLimit`; `effectivePlanFeature`.
- Produces: `createYouTubeAnalyticsHandler(deps)`, with routes `GET /overview/:clientId`, `/daily/:clientId`, `/traffic/:clientId`, `/demographics/:clientId`, `/videos/:clientId?sort=` and `/top-shorts/:clientId`.
  - **Window:** `?days=7|28|90` or `?start&end` (at most 365 days), per the window rule in Global Constraints. `?type=all|shorts|long` selects the content type.
  - **Response shapes (exported types):**
    - `YtOverview = { channel: { title, handle, avatarUrl, subscriberCount, authorizationStatus, lastSyncedAt, dataThrough, contentTypeThrough, trafficThrough }, window: { start, end, prevStart, prevEnd }, kpis: Record<YtKpiId, { value: number | null; prev: number | null }>, split: { views, minutes, likes } each { shorts: number; long: number } }`.
    - `YtKpiId` = `subscribers | net_subscribers | views | engaged_views | watch_minutes | avg_view_duration_s | likes | shares | comments`.
    - Video rows: `{ videoId, title, isShort, publishedAt, thumbnailUrl, views, engagedViews, avgViewDurationS, avgViewPct, likes, comments, subscribersGained }`, summed over the window. "Publicados no período" means videos published in the window. Sort options are `views|published_at|likes`; the default is `views`.
    - `/top-shorts` returns the top 5 Shorts by window views with `avgViewPct`.
  - **KPI math (spec §7):**
    - `subscribers` is the current count.
    - `net_subscribers` is Σ gained − Σ lost, with gained and lost exposed separately.
    - Every other KPI is a Σ, except `avg_view_duration_s`, which is weighted by views.
    - Split rows use their own content type. A missing split row for a day counts as 0 once `content_type_through` covers that day.
  - **Errors:** a missing channel row returns 404 `not_connected`. A revoked channel returns data with `authorizationStatus: 'revoked'` (empty after purge), so the UI shows the banner. Before the first sync (`dataThrough` null) the response has `kpis` all null.
  - **No AI route.** Token columns are never selected.

- [ ] **Step 1: Write failing tests**, copying the `tiktok-analytics_test.ts` cases list:
  - 401s, `active_workspace_id` use, non-member 403, foreign client 403 before flags, 429, `feature_disabled` per flag, invalid id/window/sort 400, `not_connected`, a generic 500 with no detail, unknown route 404, and no token columns.
  - **KPI tests:** the weighted mean, net subscribers, `?days=28` with `data_through` three days back giving a full 28-day window and a 28-day previous window, and a channel with no Shorts giving `split.views.shorts = 0` (Review Focus 4).
  - **Revoked:** a revoked, purged channel returns 200 with `authorizationStatus: 'revoked'` and null KPIs.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(youtube): youtube-analytics read function`.

### Task 11: `gbp-analytics` read function

**Files:**
- Create: `supabase/functions/_shared/gbp-analytics/{window,queries,kpis}.ts`
- Create: `supabase/functions/gbp-analytics/{index,handlers}.ts`
- Modify: `supabase/config.toml` (`[functions.gbp-analytics] verify_jwt = false`)
- Test: `supabase/functions/_shared/gbp-analytics/kpis.test.ts`, `supabase/functions/__tests__/gbp-analytics_test.ts`

**Interfaces:**
- Produces: `createGbpAnalyticsHandler(deps)`, with routes `GET /overview/:clientId?location=all|<uuid>&days|start,end`, `/daily`, `/surfaces`, `/keywords?month=YYYY-MM`, `/reviews?filter=all|unanswered|low`, `/rating-distribution` and `/units`.
  - **Units:** only the client's `active` and `revoked` units count. A `location` uuid outside the client returns 404.
  - **Window:** `?days=7|30|90` or `?start&end`, per the window rule in Global Constraints, where `data_through` is the **minimum** across the selected units.
  - **KPIs (spec §7):**

    | KPI id | Value |
    |---|---|
    | `profile_views` | Σ of the four impression metrics |
    | `calls`, `directions`, `website_clicks`, `messages`, `bookings` | Σ of the metric |
    | `avg_rating` | per unit, the latest `gbp_rating_daily` row on or before the window end (else null), weighted by review count across units; prev = the same rule at the window start |
    | `new_reviews` | Δ of `total_review_count` between those two rows (null when either is missing) |

  - **Routes:**
    - `/surfaces` returns the four impression sums with percentages.
    - `/keywords` returns closed months only, with the latest closed month as the default.
    - `/reviews` returns up to 50, newest first, each with `{ reviewer, rating, comment, unitTitle, unitMapsUri, createTime, hasReply }`. "Abrir no Google" opens `unitMapsUri` and is hidden while it is null, which is the case before the first location refresh.
    - `/rating-distribution` returns `{ counts: {1..5}, storedTotal, total, partial: storedTotal < total }`.
    - `/units` returns, per unit, the window sums plus `avgRating` and `totalReviewCount`.

- [ ] **Step 1: Write failing tests:** the same guard-case list as Task 10, plus:
  - the weighted rating across two units;
  - `profile_views` summing the four surfaces;
  - `partial` true when only 200 of 440 reviews are stored;
  - a foreign location uuid returning 404;
  - two units with `data_through` 10-25 and 10-27: "Todas as unidades" ends its window on 10-25;
  - `avg_rating` with no rating row before the window start gives prev null;
  - a revoked unit's data still returned.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npm run check:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(gbp): gbp-analytics read function`.

### Task 12: CRM services, query hooks and shared state cards

**Files:**
- Create: `apps/crm/src/services/youtubeAnalytics.ts`, `apps/crm/src/services/gbpAnalytics.ts`
- Modify: `apps/crm/src/services/google.ts` (add `syncGoogleProduct(product: 'youtube' | 'gbp', clientId: number)`)
- Create: `apps/crm/src/pages/analytics-conta/AnalyticsStateCards.tsx` (`StateCard`, `LoadingCard`, `LockedCard`, moved from `tiktok/TikTokAnalyticsTab.tsx`, P9)
- Modify: `apps/crm/src/pages/analytics-conta/tiktok/TikTokAnalyticsTab.tsx` (import them)
- Create: `apps/crm/src/pages/analytics-conta/youtube/useYouTubeTabData.ts`, `apps/crm/src/pages/analytics-conta/google/useGoogleTabData.ts`
- Test: `apps/crm/src/services/__tests__/youtubeAnalytics.test.ts`, `apps/crm/src/services/__tests__/gbpAnalytics.test.ts`

**Interfaces:**
- Produces:
  - The `services/tiktokAnalytics.ts` shape:
    - a private `request<T>`;
    - error classes `YouTubeNotConnectedError` and `GbpNotConnectedError`;
    - `isGoogleFeatureDisabled(err)`;
    - readers `getYouTubeOverview(clientId, range, type)`, `getYouTubeDaily`, `getYouTubeTraffic`, `getYouTubeDemographics`, `getYouTubeVideos(clientId, range, sort)`, `getYouTubeTopShorts`, `getGbpOverview(clientId, range, location)`, `getGbpDaily`, `getGbpSurfaces`, `getGbpKeywords(clientId, month, location)`, `getGbpReviews(clientId, filter, location)`, `getGbpRatingDistribution`, `getGbpUnits`.
    - The server body is never surfaced.
  - **Hooks:** they mirror `useTikTokTabData`. Overview gates the others, and query keys start with `yt-` or `gbp-` plus the `clientId`. Predicates `isYouTubeTabQuery(clientId)` and `isGbpTabQuery(clientId)`. Retries are skipped for not-connected and feature-disabled errors.

- [ ] **Step 1: Write failing tests:**
  - URLs and query strings per reader;
  - 404 `not_connected` maps to the error class;
  - a 403 `feature_disabled` body maps through `isGoogleFeatureDisabled`;
  - a 500 body is not surfaced.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/services/__tests__/youtubeAnalytics.test.ts apps/crm/src/services/__tests__/gbpAnalytics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.** Move the state cards; the TikTok tab tests must still pass.
- [ ] **Step 4: Run** the two test files, the TikTok tab tests, and `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): YouTube and GMN analytics services and hooks`.

### Task 13: YouTube analytics tab

**Files:**
- Create in `apps/crm/src/pages/analytics-conta/youtube/`: `YouTubeAnalyticsTab.tsx`, `YouTubeAnalyticsTabPhone.tsx`, `YouTubeKpiGrid.tsx`, `YouTubeDailyViewsChart.tsx`, `YouTubeSplitCard.tsx`, `YouTubeTrafficCard.tsx`, `YouTubeAudienceCard.tsx`, `YouTubeTopShorts.tsx`, `YouTubeVideosTable.tsx`
- Create: `packages/i18n/locales/pt/analyticsYoutube.json`, `packages/i18n/locales/en/analyticsYoutube.json`; register both in `apps/crm/src/boot/i18nResources.ts`
- Test: `apps/crm/src/pages/analytics-conta/youtube/__tests__/YouTubeAnalyticsTab.test.tsx`, `apps/crm/src/pages/analytics-conta/youtube/__tests__/YouTubeAnalyticsTab.phone.test.tsx`

**Interfaces:**
- Produces: `YouTubeAnalyticsTab({ clientId, phoneFrame? })`.
  - **Layout:** board 3 top to bottom. Copy comes from the mockup inventory, verbatim pt-BR.
    - **Channel row:** the period control has 7, 28 (default) and 90 days plus "Personalizado", with a "Sincronizar" button.
    - **Content type control:** "Tudo", "Shorts", "Vídeos longos", next to "Dados até {{data}}. O YouTube libera os números com 2 a 3 dias de atraso.".
    - **KPI grid:** eight cards in the mockup order. Delta caption "vs. {{n}} dias anteriores".
    - **Cards:** "Visualizações por dia" (stacked Shorts/long bars), "Shorts x vídeos longos", "De onde vêm as visualizações", "Público" (sub "Idade e gênero dos espectadores · últimos 28 dias", per spec §5.1), "Shorts em destaque" and "Vídeos" (table with "Abrir no YouTube" links via `sanitizeUrl`).
    - **Footer:** "Dados do YouTube, como o YouTube informa." (P10).
  - **Traffic labels:** `SHORTS` → "Feed de Shorts", `YT_SEARCH` → "Pesquisa", `RELATED_VIDEO` → "Sugestões", `EXT_URL` → "Links externos", `YT_CHANNEL` → "Página do canal"; every other value (`SUBSCRIBER`, `NOTIFICATION`, `PLAYLIST`, `END_SCREEN`, `HASHTAGS`, `NO_LINK_OTHER`, …) sums into "Outras origens".
  - **Watermarks:** a card whose own watermark (`contentTypeThrough`, `trafficThrough`) lags `dataThrough` shows "Dados até {{data}}" with its own date.
  - **States:** the TikTok order, using `AnalyticsStateCards`.
    - Pending shows the skeleton.
    - Not connected shows a card linking to `/clientes/:id/redes-sociais`.
    - Flag off shows the locked card.
    - An error shows retry.
    - Revoked shows the reconnect callout.
    - `dataThrough` null shows "Primeira sincronização em andamento".
  - **Phone:** the TikTok phone pattern.
  - **Charts:** Chart.js, as in the TikTok and Instagram tabs. No AI section.

- [ ] **Step 1: Write failing tests** (`vi.mock` the service with `importOriginal`; mock `chart.js`, `useWorkspaceLimits` and `useIsDesktop`):
  - each state renders its copy;
  - the eight KPI labels and values are formatted pt-BR;
  - switching "Shorts" refetches the overview with `type=shorts`;
  - "Sincronizar" calls `syncGoogleProduct('youtube', id)` and invalidates `yt-` queries;
  - a lagging traffic watermark shows its own "Dados até";
  - no element contains "IA";
  - the phone test renders the phone frame with the KPIs.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus `npx vitest run packages/i18n/__tests__/locales.test.ts` and the CRM `tsc`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): YouTube analytics tab`.

### Task 14: Google Meu Negócio analytics tab

**Files:**
- Create in `apps/crm/src/pages/analytics-conta/google/`: `GoogleAnalyticsTab.tsx`, `GoogleAnalyticsTabPhone.tsx`, `GbpKpiGrid.tsx`, `GbpActionsChart.tsx`, `GbpSurfacesCard.tsx`, `GbpKeywordsCard.tsx`, `GbpRatingCard.tsx`, `GbpReviewsList.tsx`, `GbpUnitsTable.tsx`
- Create: `packages/i18n/locales/{pt,en}/analyticsGoogle.json`; register both
- Test: `apps/crm/src/pages/analytics-conta/google/__tests__/GoogleAnalyticsTab.test.tsx` and `apps/crm/src/pages/analytics-conta/google/__tests__/GoogleAnalyticsTab.phone.test.tsx`

**Interfaces:**
- Produces: `GoogleAnalyticsTab({ clientId, phoneFrame? })`.
  - **Layout:** board 4 top to bottom.
    - **Filters:** a unit control ("Todas as unidades ({{n}})" plus one segment per unit title, or a select when there are more than 4 units), periods 7, 30 (default) and 90 days plus "Personalizado", and "Sincronizar".
    - **Note:** "Dados até {{data}}. O Google conta pessoas diferentes por dia em cada superfície.".
    - **KPI grid:** eight cards.
    - **Cards:** "Ações por dia", "Onde viram o perfil", "O que buscaram no Google" (month control with closed months only; values below the threshold read "menos de {{n}}"), "Avaliações" (the distribution, plus "Últimas 200 avaliações por unidade" when `partial`), "Avaliações recentes" (filters "Todas", "Sem resposta", "3 estrelas ou menos"; read-only; "Abrir no Google" via `sanitizeUrl`) and "Comparar unidades".
  - **Single unit:** the unit control is hidden when the client has one unit.
  - **Revoked unit:** it shows its reconnect callout (`gmn` banner copy from Phase 1's `clients.json`) and its data still renders.
  - **States:** as in Task 13. The GMN not-approved state is not reachable here, because the picker already handles it in Phase 1.

- [ ] **Step 1: Write failing tests:**
  - each state;
  - choosing a unit refetches with `location=<uuid>`;
  - a threshold keyword reads "menos de 15";
  - the review filter "Sem resposta" refetches with `unanswered`;
  - the `partial` note appears;
  - the unit control is hidden for one unit;
  - review links pass through `sanitizeUrl`;
  - the phone test.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus the i18n parity test and the CRM `tsc`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): Google Meu Negócio analytics tab`.

### Task 15: Analytics shell wiring

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsClientShell.tsx`
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsClientShell.test.tsx` (extend)

**Interfaces:**
- Consumes: Tasks 13-14 tabs; `features.feature_youtube` and `features.feature_google_business` (Phase 1 `useWorkspaceLimits`); `getGoogleSummary` (Phase 1 `services/google.ts`) for the header avatar and connected state.
- Produces:
  - **Tabs:** `ANALYTICS_TABS = ['instagram','tiktok','youtube','google','relatorios']`, labelled "YouTube" and "Google Meu Negócio".
  - **Flag gating:** `visibleTabs` hides each new tab when its flag is off, and a deep link to a gated tab redirects to `/analytics/:id/instagram` once limits load.
  - **Default tab:** `defaultAnalyticsTab` is unchanged (Instagram, then TikTok). The new tabs are never defaults in v1.
  - **Phone:** the phone tablist includes both.

- [ ] **Step 1: Write failing tests:**
  - with both flags off, the tabs are absent and the deep link redirects;
  - with the YouTube flag on, the tab is present and renders `YouTubeAnalyticsTab`;
  - the phone tablist lists the visible tabs.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, plus the CRM `tsc`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): YouTube and Google Meu Negócio tabs in client analytics`.

### Task 16: Docs, deploy order, full gate

**Files:**
- Modify: `CLAUDE.md`. Edit three places:
  - **Env vars:** add `GOOGLE_SYNC_BATCH_LIMIT` (default 25) and `GOOGLE_SYNC_CONCURRENCY` (default 4) under the edge-function variables, with the capacity line `24 × GOOGLE_SYNC_BATCH_LIMIT unit-syncs per product per day`.
  - **`--no-verify-jwt` list:** add `youtube-sync-cron`, `gbp-sync-cron`, `youtube-analytics` and `gbp-analytics`.
  - **Google gotcha:**
    - the Phase 2 deploy order: deploy the five functions first (`google-integration`, `youtube-sync-cron`, `gbp-sync-cron`, `youtube-analytics`, `gbp-analytics`; harmless before their tables exist, since nothing calls them yet), then one `supabase db push --linked` for all five migrations (`…10`-`…12`, `…20`-`…21`; `db push` applies every pending file at once, so the schedules cannot be held back), then merge;
    - the P2 note that Phase 4 must re-create `youtube_purge_channel` with the layout and `youtube_channel_id` edits, and that Phase 3, which re-creates `google_unlink_youtube` with the target/upload steps, must keep its purge call;
    - that `gbp-sync-cron` carries the privacy deletion duties, so unscheduling it breaks the policy's 30-day promise.
- Modify: `apps/crm/src/lib/googleLegalLaunch.ts`: set `GOOGLE_LEGAL_TEXT_LIVE = true`, so the privacy policy and terms name YouTube and Google Meu Negócio. This PR is the one that delivers the deletion duties the policy text promises. Drop the CLAUDE.md sentence about the constant being off.
- Test: the full gate below.

- [ ] **Step 1: Edit CLAUDE.md and flip `GOOGLE_LEGAL_TEXT_LIVE`.**
- [ ] **Step 2: Run the full gate** in a clean worktree with its own `npm ci`, because Deno runs pollute `node_modules`:
  - `npm run lint`, `npm run format:check`, and the four `tsc` commands;
  - `TZ=UTC npx vitest run --coverage --config vitest.coverage.config.ts`;
  - `npm run check:functions` and `npm run test:functions`;
  - `bash scripts/test-entitlements.sh` against a fresh local `db reset`.

  Expected: every command exits 0.
- [ ] **Step 3: Commit** `docs: Phase 2 Google deploy order, sync dials and duties; publish Google legal text`.
- [ ] **Step 4: Hand off the spikes and the staging run.** These need the user's Google Cloud project:
  - **S2:** check `creatorContentType` coverage on a channel with Shorts and long videos.
  - **S3:** find the GMN metrics range.
  - **Staging:** deploy in the CLAUDE.md order, link one channel and one unit, run each cron once by hand with the `x-cron-secret` header from a temp `--env-file`, and confirm `data_through` is set and the tabs render.
