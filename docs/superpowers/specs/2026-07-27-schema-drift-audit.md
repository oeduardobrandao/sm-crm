# Schema drift audit — migrations vs staging vs production

**Date:** 2026-07-27
**Status:** Findings complete; reconciliation not yet applied
**Trigger:** Authoring a column allowlist for
[per-admin financial visibility](2026-07-27-admin-financeiro-visibility-design.md)
required knowing the true `clientes` / `membros` columns. A single drifted column
(`clientes.data_aniversario`) turned out to be one instance of a broader pattern.

## Summary

| | Tables | Columns |
|---|---|---|
| Production | 74 | 769 |
| Staging | 68 | 706 |
| Checked-in migrations | 71 | ~714 |

**Production contains 3 tables and 11 columns that no migration creates.**
**Production is also missing 4 columns that migrations do define.** Drift runs in
both directions, so neither the migration history nor production alone is a
reliable description of the schema.

## Method

Production and staging schemas were captured with `supabase db dump --linked
--schema public` — authoritative, read-only, no writes to either environment.

The migrations baseline proved harder. `supabase start` was attempted twice to
build a database from checked-in migrations only; both attempts failed with the
Postgres container in a restart loop (`LegacyHealthCheckTimeoutError`), and the
container is removed on failure so logs did not survive. Port 54322 was already
held by an unrelated local Supabase project (`cranky-blackburn-7e2a81`), which
was **not** stopped — the reference build was attempted as an isolated project on
ports 54422/54430 instead.

The baseline was therefore established by two independent static methods:

1. **Name scan** — for each production column, does its name appear *anywhere* in
   any migration file? This has no false positives by construction: if the name
   never appears, no migration can create it. It is a lower bound only.
2. **Migration simulation** — replay `CREATE TABLE` / `ADD COLUMN` /
   `DROP COLUMN` / `RENAME COLUMN` / `DROP TABLE` in filename order.

The simulator produced **false positives** and every one of its candidates was
adjudicated by hand against the migration source. Specifically rejected as
parser artifacts, *not* drift:

- All 15 `post_media` columns — the table is created in two migrations and the
  second body failed to parse.
- `contas.brand_color`, `contas.hub_enabled` — real `ADD COLUMN` migrations exist.
- `hub_brand.primary_color`, `instagram_posts.likes`, `tiktok_posts.likes`,
  `tiktok_accounts.likes_count`, `tiktok_account_metrics_daily.likes_count` —
  all present in their `CREATE TABLE` bodies.

**Every finding below is corroborated by at least two independent methods.**
Because the live reference build did not run, treat the counts as a **floor**:
static analysis cannot see DDL executed inside `plpgsql` or dynamic SQL.

## Finding A — tables in production that no migration creates

| Table | Cols | Used by code | In staging |
|---|---|---|---|
| `cliente_enderecos` | 13 | **Yes** — full CRUD, [clients.ts:111-147](../../../apps/crm/src/store/clients.ts) | ❌ |
| `cliente_datas` | 6 | **Yes** — full CRUD, [clients.ts:157-192](../../../apps/crm/src/store/clients.ts) | ❌ |
| `subscription_events` | 6 | No references anywhere | ❌ |

`cliente_enderecos` and `cliente_datas` back the live Endereços and Datas
sections of the client detail page. Since staging has neither table, **those two
features are broken on staging today**, and any environment rebuilt from
migrations would lack them entirely.

`subscription_events` (`workspace_id`, `event_type`, `stripe_event_id`, `data`,
`created_at`) has no code references — an orphan from the Stripe work.

## Finding B — columns in production that no migration creates

| Column | Used by code | Assessment |
|---|---|---|
| `clientes.data_aniversario` | **Yes — read and written** (`ClienteDetalhePage:750,784,1060`, `CalendarioPage:897`) | Adopt |
| `instagram_accounts.updated_at` | — | Adopt or drop |
| `files.google_drive_file_id` | No references | Likely drop |
| `files.google_drive_thumbnail_url` | No references | Likely drop |
| `files.google_drive_view_url` | No references | Likely drop |
| `workspaces.stripe_customer_id` | No references | Drop — superseded |
| `workspaces.stripe_subscription_id` | No references | Drop — superseded |
| `workspaces.subscription_status` | No references | Drop — superseded |
| `workspaces.subscription_cancel_at_period_end` | No references | Drop — superseded |
| `workspaces.subscription_current_period_end` | No references | Drop — superseded |
| `workspaces.trial_ends_at` | No references | Drop — superseded |

**Billing state exists in two places in production.** Migration
`20260609120003` creates `workspace_subscriptions` (13 columns, present in prod),
and every billing consumer uses it — `services/billing.ts`, `stripe-webhook`,
`billing-checkout`, `billing-portal`, `platform-admin`, `retention-radar-cron`.
The six `workspaces` billing columns are dead remnants of an earlier iteration.
They are harmless today but are exactly the kind of thing a future reader
mistakes for the source of truth.

## Finding C — columns migrations define that production lacks

| Column | Defined in | In staging |
|---|---|---|
| `hub_brand.created_at` | `20260415000001` | ✅ |
| `hub_brand_files.created_at` | `20260415000001` | ✅ |
| `instagram_posts.created_at` | `20260301_baseline_schema` | ✅ |
| `instagram_follower_history.created_at` | `20260301_baseline_schema` | ✅ |

**This reveals the mechanism behind the whole pattern.** These migrations use
`CREATE TABLE IF NOT EXISTS`. Where the table had already been hand-created in
production, the migration silently no-oped and production kept the manual shape —
permanently, and with the migration recorded as applied. Staging, built more
faithfully from migrations, got the defined shape.

`CREATE TABLE IF NOT EXISTS` therefore does not make a migration authoritative;
it makes it *conditional*, and the condition has been silently false in
production for months.

## Finding D — production and staging have diverged from each other

Prod has 8 tables staging lacks: `cliente_datas`, `cliente_enderecos`,
`subscription_events`, and five `tiktok_*` tables. Most of the TikTok and Stripe
gap is expected lag, consistent with the known blocker that aborts
`supabase db push` against staging.

The reverse direction is more surprising — staging has, and prod lacks:

- `designs`, `ai_image_generations` — Estúdio tables prod dropped in
  `20260722000002`, still present on staging.
- `plans.feature_ai_images`, `plans.feature_estudio`,
  `plans.rate_ai_images_per_month`.
- The four `created_at` columns from Finding C.

Staging is therefore not a valid rehearsal environment for production migrations
today. Any rollout that depends on rehearsing against staging — including the
financial-visibility rollout — is rehearsing against a different schema.

## Recommended reconciliation

Sequenced before any further schema work:

1. **Decide adopt-or-drop for each item in Findings A and B.** Adopt means
   writing a migration that creates the object as it exists in production; drop
   means deleting it. The unreferenced items (`subscription_events`, the three
   `files.google_drive_*`, the six `workspaces` billing columns) are drop
   candidates, but dropping is destructive and needs explicit sign-off per item.
2. **Write reconciling migrations**, following the precedent of
   `20260720000004_reconcile_prod_missing_functions.sql`. Adoption migrations
   must be written so they are no-ops where the object already exists, and must
   *not* use bare `CREATE TABLE IF NOT EXISTS` for tables whose shape differs —
   that is the failure mode that created Finding C.
3. **Resolve Finding C explicitly.** Adding the four missing `created_at`
   columns to production is additive and low-risk, but it is a production schema
   change and should be a deliberate step, not a side effect.
4. **Re-run this audit** and require a clean three-way diff as the exit
   criterion.
5. **Then** author the `clientes` / `membros` allowlists for the
   financial-visibility feature, generated from the reconciled schema.

## Follow-ups worth tracking separately

- **The reference build should work.** Not being able to stand up a database from
  checked-in migrations is itself a finding: it means nobody can verify what the
  migrations produce. This also blocks running `test:db` in CI. Worth fixing
  properly rather than working around.
- **Add a drift check to CI** once a reference build is possible, so this cannot
  silently recur.
- **Audit function, policy and index drift.** This audit covered tables and
  columns only. `20260720000004_reconcile_prod_missing_functions.sql` shows
  function drift has already happened at least once.

## Reproducing

Scripts used are in the session scratchpad and are not checked in:
`parse_schema.py` (pg_dump → `table.column` inventory) and
`simulate_migrations.py` (static migration replay). Both are small enough to
rewrite; the pg_dump captures are the part worth keeping.
