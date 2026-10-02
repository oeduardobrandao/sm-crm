# DB query performance audit (prod, 2026-10-01)

Source: prod (`skjzpekeqefvlojenfsw`) `pg_stat_statements`, 7 days of data (reset 2026-09-24 19:24 UTC, the
MICRO→SMALL restart), 1,518 distinct statements, 17,939 s total executor time. Read-only catalog/stat
queries only. Verification EXPLAINs as a real user were **not** run (see "Verification still needed").

## TL;DR

Data volume is not the problem. The biggest hot table has 15k rows; everything is 100% cache-hit. Slowness
comes from three multiplying factors:

1. **An RLS chain through `profiles` that costs ~7 ms per hop** and sits under 28 policies on 19 tables
   (workflows, workflow_etapas, workflow_templates, instagram_*, banners/popups, …). That sets a floor of
   7 / 14 / 31 ms on queries that should take <1 ms.
2. **N+1 request fan-out in the frontend.** Concluídos and the client Entregas tab fire 2 requests per
   concluded workflow, and Calendário fires 1 per active workflow, all in parallel.
3. **A 2-vCPU box absorbing those bursts.** Means run 5-8× the floors (e.g. `workflow_etapas`: floor
   14.5 ms, mean 118 ms, stddev 125 ms). That gap is queueing, not work.

Fixing (1) cuts every floor; fixing (2) removes the bursts that inflate the means. Both are needed: (1)
alone still leaves Concluídos firing hundreds of requests, (2) alone still pays 7-31 ms per call.

## Evidence: floors vs. means

`min_exec_time` is what a query costs with no contention; `mean` includes queueing.

| Query (PostgREST) | Rows in table | Calls/7d | Min | Mean | Profiles hops in RLS |
|---|---|---|---|---|---|
| `workflow_templates` select * | 5 | 12.6k | 7.2 ms | 40.9 ms | 1 |
| `workflows` select * | 825 | 12.2k | 7.4 ms | 40.4 ms | 1 |
| `global_banners` | ~15 | 12.4k | 7.0 ms | 32.5 ms | 1 |
| `global_popups` | small | 6.6k | 8.2 ms | 37.5 ms | 1 |
| `workflow_etapas` where workflow_id=$1 | 4.7k | 11.1k | 14.5 ms | **117.6 ms** | 2 (via workflows) |
| `workflow_etapas` + workflows!inner (Entregas) | 4.7k | 12.6k | 7.9 ms | 65.4 ms | 2 |
| `UPDATE workflow_etapas … WHERE id=$2` (single row) | 4.7k | ~1.4k | **31.7 ms** | 39 ms | ~4 (USING re-applied as the check) |
| `clientes_v` (control: view without `security_invoker`, so no table RLS) | 350 | 32.3k | 0.35 ms | 21.2 ms | 0 |

The floors scale with the number of `profiles` hops: about 7, 14 and 31 ms. The `workflow_etapas_update`
policy has only USING (2 hops). With no WITH CHECK, Postgres applies the same expression to the new row, so
it's evaluated twice. `clientes_v`/`membros_v` are `security_barrier` views *without* `security_invoker`, so
they run as the owner and skip table RLS. That makes them a "no-RLS" control, not a "no-hop" one. They have a
0.35 ms floor.

Independent corroboration: over the same 7 days, `profiles` had **35.9M index scans** and `workspace_members`
**38.7M**, against ~1M authenticated requests (`set_config` count). `get_my_conta_id()` does exactly one pkey
lookup on each of those tables, so that's ~36 evaluations per request. That only happens if it's evaluated
per row somewhere.

JIT is off (`jit = off`), so it's ruled out.

## Status (2026-10-02)

Implemented on `claude/db-query-performance-audit-2dc21f` (uncommitted when written):
- Finding 2: `getWorkflowEtapasByWorkflowIds` + `getConcludedWorkflowSummaries` (store/workflows.ts),
  `fetchAllPagedByIds` (store/paging.ts). Used by ConcludedView, the client EntregasTab (active + concluded)
  and Calendário. `getWorkflowPostsCounts` is now chunked + paged, which also removes its silent
  1000-row cap.
- Finding 5 + 1d: migration `20261002000001_perf_files_thumbnail_idx_views_initplan.sql` (full index, not
  partial, see the migration comment).

Not started: 1a/1b/1c (RLS), 3 (count RPC), 4 (realtime), 6.

## Findings, ranked by user-visible impact

### 1. `profiles` RLS policy evaluated per row (DB, highest leverage)

Live policy on `profiles`:

```sql
"Users can view own workspace profiles" FOR SELECT
USING ((id = auth.uid()) OR (conta_id = get_my_conta_id()))
```

28 policies on 19 tables do `conta_id IN (SELECT profiles.conta_id FROM profiles WHERE profiles.id = auth.uid())`.
That subquery runs under `profiles`' own RLS. With 171 rows (~11 pages), the planner seq-scans `profiles`.
RLS quals run first as a security barrier, so for each of the 171 rows Postgres evaluates `id = auth.uid()`
(false for 170 rows) and then calls `get_my_conta_id()`. That's a SECURITY DEFINER SQL function doing two
lookups and two `auth.uid()` JWT-claim parses, and it can't be inlined. 171 × ~40 µs ≈ 7 ms per hop.

Corroboration: `profiles` shows **198,871 seq scans × ~164 rows each** (32.7M tuples read) on a 171-row table.

Tables whose policies go through `profiles`: analytics_reports, audit_log, contas, global_banners,
global_popups, instagram_accounts, instagram_analytics_cache, instagram_follower_history,
instagram_post_tag_assignments, instagram_post_tags, instagram_posts, portal_tokens, tiktok_accounts,
tiktok_follower_history, tiktok_posts, workflow_etapas, workflow_templates, workflows,
workspace_subscriptions.

**Fix (migration, two layers):**
- a. Wrap the `profiles` policy calls in scalar subqueries so they become once-per-query initplans:
  `USING (id = (select auth.uid()) OR conta_id = (select get_my_conta_id()))`. This is Supabase's
  documented `auth_rls_initplan` fix. It shrinks the per-hop cost from ~7 ms to ~µs on its own.
- b. Replace `conta_id IN (SELECT profiles.conta_id FROM profiles WHERE id = auth.uid())` in the 28
  policies with the pattern the newer tables already use: `conta_id IN (SELECT get_my_conta_id())`
  (SECURITY DEFINER, so it skips `profiles` RLS entirely). **Semantics differ:** `profiles.conta_id` vs.
  `get_my_conta_id()` (= `active_workspace_id` with a membership check). These have to be confirmed
  equivalent, or deliberately aligned, for multi-workspace users before swapping. If in doubt, ship (a)
  alone first: it's semantics-neutral.
- c. `workflow_etapas` has no `conta_id` column (verified). Its four policies (select/insert/update/delete)
  can use `workflow_id IN (SELECT id FROM workflows WHERE conta_id IN (SELECT get_my_conta_id()))`,
  which still drops the hop through `workflows`' own RLS. Adding a denormalized `conta_id` is the bigger,
  optional alternative.
- **Migration safety:** the repo's tracked shape for this policy (`20260315_rls_security_audit.sql`:
  `conta_id = get_my_conta_id()`) differs from what's live in prod (above), and prod/migration drift is
  documented (`20260720000004_reconcile_prod_missing_functions.sql`). The migration should assert the
  current policy name/expression (`pg_policies`) before dropping, and state the exact target policy set,
  so it can't miss the live policy or overwrite a differently hardened one.

The same family of fixes applies more broadly: **76 of 267 policies call `auth.uid()` bare** (not wrapped
in `select`), and `get_user_conta_id()` is **VOLATILE** and used bare in the `clientes` and `membros`
policies (3 policies), so it's re-executed per row. Mark it `STABLE` and wrap it. The Supabase dashboard's
Performance Advisor (`auth_rls_initplan` lint) will list each of these.

Expected effect: floors on the table above drop from 7-31 ms to roughly 0.5-2 ms. Because every page load
fires 10-20 of these in parallel, the queueing behind them shrinks too.

Scope: one migration, plus entitlement-suite runs (`supabase/tests/entitlements`) since this is RLS.
Per CLAUDE.md this is brainstorm/plan territory (auth/RLS).

### 2. N+1 request fan-out (frontend)

| Where | Pattern | Requests per view |
|---|---|---|
| `apps/crm/src/pages/entregas/views/ConcludedView.tsx:117-125` | for **every** concluded workflow: `getWorkflowEtapas` + `getWorkflowPosts` | 2 × N concluded (unbounded, grows forever) |
| `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx:242-250` | same, per client's concluded workflows | 2 × N |
| `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx:306` | `getWorkflowEtapas` per active workflow | N active |
| `apps/crm/src/pages/calendario/CalendarioPage.tsx:746` | `getWorkflowEtapas` per active workflow | N active |

This is where the 11k calls of `workflow_etapas where workflow_id=$1` come from, at 118 ms mean. Each
fan-out goes out over HTTP/2 in one burst and lands on 2 vCPUs.

**Fix:**
- ConcludedView / EntregasTab concluded summaries: they only need `firstStart`, `lastEnd`, `totalDays` and
  post counts per workflow. One RPC or view (`concluded_workflow_summaries`), or one
  `.in('workflow_id', ids)` per table (chunked to keep URLs short), grouped client-side. 2N → 1-2
  requests, with the same complete history as today. Paginating concluded history is a separate product
  decision (page size, order, how older items surface) and out of scope for the perf fix.
- Calendário / EntregasTab active: add a scoped bulk fetch, `getEtapasForWorkflows(ids)` with
  `.in('workflow_id', ids)`, ordered `workflow_id, ordem`. Don't reuse `getAllActiveEtapas()`: it fetches
  every active etapa in the workspace plus joins, which is wrong-scoped for a single client's tab.

Note: `pg_stat_statements` excludes time spent waiting for a PostgREST pool connection. A 2N burst queues
in PostgREST before it reaches Postgres, so what users feel on these screens is *worse* than the 118 ms
mean.

Scope: frontend-only, small; no schema change needed for the `.in()` version.

### 3. Entregas board: 6 count queries that fetch rows to count client-side

`apps/crm/src/pages/entregas/hooks/useEntregasData.ts:357-392`: posts-counts, approved-counts,
cleared-cliente-counts, revisao-interna-counts and awaiting-cliente-counts each select
`workflow_posts.workflow_id` rows filtered by status and count them client-side (stat rows #23, #28, #33:
~80k calls/7d combined). A single `rpc('workflow_post_counts', { workflow_ids })` returning one row per
workflow with `count(*) FILTER (WHERE …)` columns replaces five round trips. The RPC contract has to pin
each existing status predicate exactly (`CLIENT_CLEARED_STATUSES` and the others in `store/posts.ts`),
because the board's etapa-advancement logic reads these counts. The responsaveis query (`posts.ts:845`,
stat #38) isn't a count: it builds a deduplicated `Map<workflow_id, responsavel_id[]>` in
first-seen order. Either fold it in as `array_agg(DISTINCT responsavel_id) FILTER (WHERE responsavel_id IS
NOT NULL)`, with ordering defined, or keep it as its own query. `workflow_posts` shows 105k seq scans ×
~4.3k rows. Once RLS is cheap, check whether these still seq-scan
(`idx_workflow_posts_workflow` exists).

The page mounts about 16 queries on first load (workflows, clientes, membros, templates, etapas, covers,
6 counts, avatars, hub tokens, slug, post-processes, process covers). After 2 and 3 it would be about 9.

### 4. Realtime WAL poller is 38% of all DB time

`realtime.list_changes` runs 1.22M times/7d (~2/s): 6,900 s, 38% of total executor time. The publication
only has `workspace_members` and `workspace_roles` (26 subscriptions, from
`apps/crm/src/context/AuthContext.tsx:870,933`). Postgres Changes decodes **all** WAL to filter for those
two tables, including every cron write and every `net._http_response` insert/delete.

**Fix:** move those two listeners to Realtime **Broadcast from Database** (a trigger calling
`realtime.broadcast_changes` on the two tables, client subscribes to a private channel), then drop both
tables from `supabase_realtime`. With an empty publication the WAL poller stops. Steady ~1% of a core
returns to user queries.

Scope: migration + AuthContext change, and it needs its own design. The current listeners subscribe only
to `UPDATE`. Deleted memberships are caught by the 60 s membership poll, because default replica identity
doesn't carry the deleted row's `user_id` (`AuthContext.tsx:850`). The design has to define:
- topic derivation and private-channel authorization (`realtime.messages` policies)
- which of INSERT/UPDATE/DELETE broadcast
- payload minimization
- whether the polling fallback stays

Otherwise revocation can get slower, or silently stop for deletes.

### 5. Missing index: `files.thumbnail_r2_key`

The `post-media-cleanup-cron` orphan scan (`supabase/functions/post-media-cleanup-cron/orphan-scan.ts:80-81`)
looks up `files` (and `post_media`) by `thumbnail_r2_key = ANY($1)`: 30.5k calls/7d. `files` has an index on
`r2_key` but not on `thumbnail_r2_key`, hence **30,720 full seq scans** of 15k rows (428M tuples read). It's
background work, but it competes for the same 2 vCPUs as user traffic. Fix:
`create index files_thumbnail_r2_key_idx on files (thumbnail_r2_key) where thumbnail_r2_key is not null`
(and check `post_media`, which also exists, the same way). Use plain `CREATE INDEX`, not `CONCURRENTLY`:
`db push` runs each migration in a transaction, and `CONCURRENTLY` fails there. At 15k rows the brief
write lock is negligible. Rollback is `drop index files_thumbnail_r2_key_idx`.

### 6. Smaller items

- **`get_client_health_aggregates`**: 174 ms mean (17 ms floor), 729 calls. It filters
  `instagram_follower_history` with `h.date::date >= current_date - p_window_days`; the cast prevents
  index use on `date`. Compare against `h.date >= (current_date - p_window_days)` directly. It also inherits
  finding 1 through `instagram_*` RLS (SECURITY INVOKER). Neither of its definitions
  (`20260625130000`, `20260830000003`) declares a volatility, so it defaults to VOLATILE; prod confirms
  `provolatile = v`. Declaring `STABLE` is correct for a read-only function, but it's a minor gain.
- **`recent_cron_failures`** (service role, Admin): 138 ms mean, 248k blocks read from disk (64% hit). It
  scans `cron.job_run_details`. Low call count; filter on `start_time` with a narrower window or
  snapshot into a small table.
- **`instagram_accounts` count with `head:true`** (stat #52, 617 calls, 39 ms): `select id … count=exact`
  over the whole table under RLS (clientes → profiles). Cheap once finding 1 lands.
- **`workflow_templates`** is 240 kB for 5 live rows / 32 dead. `select *` pulls the etapas JSON on every
  call (12.6k calls). Select only list columns, or raise `staleTime`, since templates rarely change.
- **Global `staleTime` is 30 s** (`apps/crm/src/App.tsx:93`). Near-static data (templates, membros,
  banners, popups, workspace slug, kb_context_links) could use 5-10 min. Banners alone are 12.4k calls/7d,
  for a table that changes a few times a month.
- `pg_timezone_names` (224 ms) is PostgREST schema-cache reload; `net._http_response` cleanup and
  `claim_posts_for_*` are pg_cron/pg_net internals. Ignore these on the dashboard's slow list.

## Suggested order

1. **Index on `files.thumbnail_r2_key`**: one line, zero risk.
2. **N+1 removals (finding 2) + count RPC (finding 3)**: frontend-only (plus one small RPC), the biggest
   felt improvement on Entregas/Concluídos/Calendário/Cliente tabs.
3. **RLS initplan wrapping (finding 1a + bare `auth.uid()` + `get_user_conta_id` STABLE)**:
   semantics-neutral, one migration, entitlement suites as the gate. Speeds up every page.
4. **RLS `profiles` → `get_my_conta_id()` swap (1b/1c)**: needs the multi-workspace semantics decision.
5. **Realtime → Broadcast (finding 4)**: own plan.

## Verification (run 2026-10-02 on prod as the largest workspace's owner)

Finding 1 is **confirmed**. In every plan that touches `profiles`:

```
Seq Scan on profiles  (actual time=1.3..4.8 rows=1)
  Filter: ((id = auth.uid()) OR (conta_id = get_my_conta_id())) AND (id = auth.uid())
  Rows Removed by Filter: 171      Buffers: shared hit=865
```

The policy qual is evaluated before the query's own `id = auth.uid()`, across all 171 rows. That's
`get_my_conta_id()` run ~170 times, about 4.7 ms and 865 buffer hits per hop on a quiet box.

| Query | Execution | Profiles hops | Time in `profiles` scans |
|---|---|---|---|
| workflow_templates (2 rows) | 4.9 ms | 1 | 4.7 ms (96%) |
| workflows (170 rows) | 5.1 ms | 1 | 4.6 ms (90%) |
| workflow_etapas, one workflow (7 rows) | 10.0 ms | 2 | 9.5 ms (95%) |
| global_banners (0 rows) | 4.6 ms | 1 | 4.6 ms (99%) |

### New finding 1d: `clientes_v` / `membros_v` call `can_see_financials()` per row

`clientes_v` took **11.5 ms for 27 rows** (526 buffers). The `profiles` chain isn't involved: the view
filters with an index condition on `get_my_conta_id()`, evaluated once. The cost is in the select list:

```sql
CASE WHEN public.can_see_financials() THEN c.valor_mensal ELSE NULL END
```

`can_see_financials()` → `has_permission()` → `has_permission_for(auth.uid(), get_my_conta_id(), …)`. It's
SECURITY DEFINER with `SET search_path`, so it can't be inlined and runs once per row (~0.35 ms each).
Cost grows linearly with client count: ~35 ms for a 100-client workspace. `clientes_v` is the
most-called list query (32k calls/7d). `membros_v` has the same pattern (`custo_mensal`).

**Fix:** `CASE WHEN (SELECT public.can_see_financials()) THEN …` in both views, which turns it into a
once-per-query initplan. Semantics-neutral (no row filtering changes), same columns, so the column-grant
allowlist (`20260728000002`) is unaffected. Expected: ~11 ms → ~2 ms for 27 clients, flat as the client
count grows.

Updated expectation for finding 1a: wrapping the `profiles` policy removes ~4.7 ms per hop. Templates,
workflows and banners should drop to well under 1 ms, and single-workflow etapas from ~10 ms to ~0.5 ms.
