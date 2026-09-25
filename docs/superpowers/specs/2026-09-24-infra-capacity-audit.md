# Infra Capacity Audit — 2026-09-24

Triggered by the prod outage of 2026-09-24, ~19:04–19:23 UTC (PostgREST `PGRST002`, every
data request failing). Prod project `skjzpekeqefvlojenfsw`, us-east-1, Postgres 17, Supabase Pro.

## 1. What happened (confirmed)

- **Cause: memory starvation on the MICRO compute (1 GB RAM).** The dashboard's Database
  report for the 24h before the outage shows ~450 MB of **swap in use continuously**, memory
  commitment well above the commit limit, and CPU time that was mostly **IOwait** (swap
  traffic), peaking ~30% in business hours. A plain `SET` took 47 s; new connections and
  pg_cron job startups timed out; PostgREST could not load its schema cache.
- **Not the cause:** traffic (the hour before had fewer requests than 13:00 UTC), crons (all
  are light `net.http_post` hand-offs, 0.1–1 s), disk IO (a few MB/s of 125 MB/s; IOPS far
  below 3000), connections (≤41 of 60), code deploys (`main` unchanged), or Supabase (no
  us-east-1 incident in that window).
- **Why memory, not data:** on Supabase the DB VM also runs PostgREST, GoTrue, Realtime,
  Storage API, pooler and log agents. Most memory is that fixed overhead plus
  `shared_buffers`, set per tier. Our real data (~170 MB) is small. MICRO was simply too small
  for the platform stack, and the tipping point was a normal load peak.
- **Fix applied:** compute upgraded MICRO → SMALL (2 GB) + restart at 19:24 UTC.
- **Collateral:** ~20 min of failed cron runs. No scheduled posts were missed (claim RPC has no
  lower bound on `scheduled_at`). One `instagram-sync-cron` hourly run (19:07) was lost; the
  ~70 accounts it would have synced are picked up by the next run.

## 2. Current resources vs limits

| Resource | Limit (SMALL) | Used now | Headroom | Binds when |
|---|---|---|---|---|
| RAM | 2 GB (shared 2 vCPU) | ~1.3–1.5 GB committed on MICRO; SMALL steady state **not yet measured** | Probably OK; verify at peak | §6 RAM rule |
| CPU | 2 shared vCPU (burstable) | 5–8% real (user+sys); the 30% seen was swap IOwait | Large | Sustained > 40% at peak |
| Direct connections | 90 | ≤41 peak | 2× | Not within 12 months |
| Pooler connections | 400 | ~1 | — | Not used by the apps |
| Disk | 8 GB gp3 (auto-expands) | 445 MB (≈170 MB real + 250 MB cron-log bloat) | 18× | > 2 years |
| Disk IO | 174 MB/s baseline, 3000 IOPS | ~7 MB/s, < 800 IOPS | Large | Only under swap |
| REST traffic | no hard cap | ~300k/day, ~8 req/s peak | Large | Not a limit at this scale |

Postgres settings on SMALL: `shared_buffers` 640 MB, `work_mem` 5 MB, `max_connections` 90,
`statement_timeout` 8 s (authenticated), 3 s (anon), 120 s default.

## 3. Growth (from prod data)

| Month | New workspaces | New users | New clientes | Posts | IG accounts connected | IG post rows |
|---|---|---|---|---|---|---|
| Jul | 17 | 20 | 39 | 471 | 34 | 961 |
| Aug | 26 | 47 | 91 | 1,065 | 59 | 3,210 |
| Sep (24 d) | 21 | 55 | 143 | 1,687 | 102 | 6,545 |

Totals: 79 workspaces (32 paid), 153 users (33 active / 7 d, 98 / 30 d), 317 clientes,
227 IG accounts (207 active on auto-sync plans). New workspaces grow roughly linearly
(~25/month). **Usage per workspace grows fast: posts ~1.6×, IG accounts ~1.7×, IG post rows
~2× month over month.**

## 4. Projections (when each limit is hit)

Two scenarios. *Linear*: September's monthly additions repeat. *Accelerating*: additions keep
growing ~1.5× per month, as they have since July.

| Limit | Linear | Accelerating | Notes |
|---|---|---|---|
| **IG sync capacity** (6 × `SYNC_BATCH_LIMIT` = 600 accounts; prod dials 100/10) | ~Jan 2027 | **~late Nov 2026** | Nearest real ceiling. A 100-account run already approaches the 150 s edge-function limit (see the 2026-09-22 capacity audit, Q3). Raising the dials does not help past this; it needs the sharding work. |
| **RAM on SMALL** | not data-driven | not data-driven | A step function per tier, not proportional to users. Watch with the §6 RAM rule. |
| **CPU on SMALL** | > 12 months | ~6–9 months | Real CPU is ~5–8%. It tracks active users (+35%/month). |
| **PostgREST 1000-row cap** (`max_rows` = 1000; this is a correctness limit, not a performance one) | see notes | see notes | Measured 2026-09-24: both queries are cheap (`/portfolio` latest-post 2.4 ms for 2,368 rows; `hub-posts` 0.4 ms for the largest client's 112 posts, both on index scans), so the 8 s timeout is ~1000× away. **Corrected from the first draft, which predicted timeouts by December.** The real cliff is silent truncation. `/portfolio` already gets only the newest 1000 rows in 3 workspaces; that window covers ~108 days in the largest one, so an account idle longer than that shows no last post (0 affected today; the window shrinks as workspaces add accounts). `hub-posts` orders by `scheduled_at` ascending, so past 1000 posts a client would lose its **newest** posts. The top clients add ~50–60 posts/month against a max of 112 today, so that is ~15+ months away. |
| Direct connections (90) | > 12 months | > 12 months | |
| Disk (8 GB) | > 2 years | ~18 months | Auto-expands; cost only. |

## 5. Risks that could cause another outage (ranked)

1. **No external monitoring or alerting.** You found this outage yourself. Nothing inside
   Supabase can alert when Postgres itself is down (pg_cron dies with it). → Add an off-platform
   uptime check (for example Better Stack, UptimeRobot or Checkly) on
   `GET https://api.mesaas.com.br/rest/v1/plans?select=id&limit=1` with the anon key
   (`apikey` + `Authorization: Bearer`) every 60 s. **Healthy means exactly: HTTP 200, in
   under 5 s, with a body that is a non-empty JSON array containing `"id"`.** `plans` is
   anon-readable by design (policy `plans_public_read`, migration `20260430100001`). Anything
   else alerts after 2 consecutive failures, including 401/403/404: a rotated anon key or a
   broken monitor config must page, not read as healthy. Also watch the site root (expect 200).
2. **SMALL not yet verified at peak.** → Apply the RAM rule in §6 to tomorrow's
   12–19 UTC peak (Observability > Database > Memory usage, 24 h view, hourly samples).
3. **Pending platform upgrade** `17.6.1.063 → 17.6.1.166` (eligible, ~1 h estimate). It
   carries Supabase's fixes, including the long-running "401 JWT rejection" incident. →
   Schedule it in the traffic trough (05–08 UTC = 02–05 BRT).
4. **Backups: daily only, PITR off.** A bad migration or data corruption loses up to 24 h of
   data. → PITR add-on (7 days, ~$100/month; SMALL or above) if that loss is unacceptable.
5. **`cron.job_run_details` bloat:** 278 MB heap for 21 MB of rows (62% of the database).
   The bloat is dead space left by the one-time trim of ~330k rows in migration
   `20260925000023`, not a retention problem: 7 days of history is only ~21 MB, and the space
   is reused, so it is not growing. It still costs something: `recent_cron_failures` and
   `recent_cron_last_success` (cron-health-cron, hourly) and the daily purge seq-scan all
   270 MB, pushing hot data out of `shared_buffers`. **Retention stays at 7 days**; the
   existing `cron-job-run-details-purge` job is unchanged and no new migration or job is
   added. `VACUUM FULL` is not available to us: the table is owned by `supabase_admin` and
   `postgres` is not a member (it does hold TRUNCATE). Procedure in §8.
6. **Supabase Pro has no uptime SLA.** An SLA and priority support start at Team or
   Enterprise. Detection and fast restart (see the memory note) are the realistic mitigation.
7. **Minor:** `idle_in_transaction_session_timeout` is 0 for the app roles. Low risk, since
   PostgREST wraps each request in its own transaction, but set 60 s on `authenticated` and
   `anon` as a guard.

## 6. Upgrade triggers (metric-based, not date-based)

| Signal (dashboard, at peak) | Action |
|---|---|
| **RAM rule (the single threshold):** swap > 100 MB in 2 or more consecutive hourly samples during 12–19 UTC, on any day | SMALL → MEDIUM the same day |
| CPU (user+sys, excluding IOwait) > 40% in 2 or more consecutive hourly samples during 12–19 UTC | MEDIUM → LARGE (dedicated CPU, no burst credits) |
| Connections > 70 of 90 in any hourly sample | Next tier (the connection limit rises per tier). First read the Connections chart by role to see what grew. No edge function holds a direct Postgres connection (all use supabase-js over HTTP), so there is nothing to repoint at the pooler. |
| Auto-sync accounts > 450 (75% of 600) | Start instagram-sync-cron sharding (2026-09-22 audit, Q3.2) |
| Any REST p95 > 1 s in the API Gateway report | Investigate the slowest `pg_stat_statements` entries |

## 7. Action list

| # | Action | Effort | When |
|---|---|---|---|
| 1 | External uptime monitor + alert | 15 min | Today |
| 2 | Apply the §6 RAM rule to tomorrow's peak | 5 min | Tomorrow |
| 3 | Reclaim `cron.job_run_details` space (§8); retention unchanged | ~2 h window, 10 min hands-on | This week, 03:40 UTC |
| 4 | Platform upgrade to 17.6.1.166 | 1 h window | This week, 05–08 UTC |
| 5 | Decide on PITR | decision | This week |
| 6 | `/portfolio` latest-post: replace the fetch-all with a per-account `DISTINCT ON` / `MAX` (measured 1.0 ms returning 25 rows instead of 2,368), in both `instagram-analytics/index.ts:703` and the browser copy in `apps/crm/src/services/analytics.ts:354`. Small correctness fix. `hub-posts` pagination is a payload/UX project (client-token scope, the 2026-09-22 Q2.1 contract), not capacity; it has its own spec and must land before any client nears 1000 posts. | ~2 h / 1–3 days | Portfolio soon; hub within ~12 months |
| 7 | instagram-sync-cron sharding | multi-day | Before ~450 auto-sync accounts |
| 8 | Staging runs the same starved tier (UNHEALTHY 3× in Sept) | decision | Optional |

## 8. Procedure: reclaim `cron.job_run_details` space

One path. `VACUUM FULL` is not an option (the table is owned by `supabase_admin`), so this uses
`TRUNCATE`. It is irreversible for the table itself, so history is snapshotted first.
Retention and the `cron-job-run-details-purge` job are not touched.

**Window:** 03:40 UTC (00:40 BRT). That is after the 03:30 purge and inside the traffic trough.
Hands-on time is ~10 min; step 5 waits 90 min.

1. **Snapshot history (this is the rollback):**
   `CREATE TABLE public._ops_job_run_details_20260925 AS SELECT * FROM cron.job_run_details;`
   Check that the row counts match. Revoke all access from `anon` and `authenticated`: the
   table is only there for forensics.
2. **Pause the health monitor:** `SELECT cron.alter_job(job_id := 27, active := false);`
   (`cron-health-cron`). Without this, its 70–90 min look-back would see no successes right
   after the truncate and send false "stale job" alerts.
3. **Truncate:** `TRUNCATE cron.job_run_details;` This takes an ACCESS EXCLUSIVE lock for
   milliseconds. A cron job starting at that instant waits for the lock, then writes its row
   normally.
4. **Verify:** `pg_total_relation_size('cron.job_run_details')` drops to KBs, and new rows
   appear within a minute (the every-minute crons).
5. **Resume the monitor after 90 min** (at ~05:15 UTC), once every hourly job has at least
   one success inside the window: `SELECT cron.alter_job(job_id := 27, active := true);`
6. **Keep the snapshot for 7 days** (the same horizon as retention), then drop it.

**Rollback:** the table's lost history lives in the snapshot; query it directly when
investigating. If step 5 is forgotten, cron failures go unalerted, so put a reminder on it
before starting. No code or migration changes are involved.

**Scheduled 2026-09-24 as one-shot pg_cron jobs in prod** (each unschedules itself): #53
`ops-jrd-truncate` (2026-09-25 03:40 UTC: steps 1–3 in one transaction with
`lock_timeout` 5 s, so a lock wait rolls back everything), #54 `ops-jrd-resume-health`
(05:15 UTC, step 5; harmless if #53 failed) and #55 `ops-jrd-snapshot-drop` (2026-10-02
04:00 UTC, step 6). The snapshot goes to `ops.job_run_details_20260925`; the `ops` schema is
not exposed through PostgREST and has access revoked from anon and authenticated. The whole
body was dry-run inside a rolled-back transaction first.

## Review log

External review (Codex, 2026-09-24) — all six points accepted:
- VACUUM FULL / TRUNCATE ambiguity → a single procedure (§8). Verified that `postgres` cannot
  VACUUM FULL (not the owner) but holds TRUNCATE.
- Changing the existing purge job → went further: the original draft's 3-day retention is
  dropped. The bloat is leftover dead space, not retention, and 7 days was chosen on purpose
  in `20260925000023`.
- hub-posts scope → corrected to client-token scope; the contract changes are listed in §7.6.
- "Pooler for edge functions" → removed; verified that no function uses a direct Postgres
  client.
- Monitor passing on 401/403/404 → an exact 200 + body assertion (§5.1).
- Conflicting swap thresholds → one rule with a defined window (§6).
