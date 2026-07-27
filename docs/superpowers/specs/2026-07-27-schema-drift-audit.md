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

**Production contains 3 tables and 13 columns that no migration creates.**
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
- ~~`contas.brand_color`, `contas.hub_enabled`~~ — **this clearance was wrong.**
  `20260505100002_workspaces_hub_columns.sql` adds those columns to
  **`workspaces`**, not `contas`. Matching a column name without checking the
  table produced a false clear; both are genuine drift and are listed in
  Finding B. The same mistake was caught on `workspaces.stripe_customer_id`
  (defined on `workspace_subscriptions`) and missed here. **Any name-based
  adjudication must match table *and* column.** Discovered when staging still
  differed from production on exactly these two columns after reconciliation.
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
| `instagram_accounts.updated_at` | No references | Drop |
| `contas.brand_color` | No references *on `contas`* | Drop candidate |
| `contas.hub_enabled` | No references *on `contas`* | Drop candidate |
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

## Status — staging reconciled 2026-07-27

Both reconciliation migrations are applied to staging
(`wlyzhyfondykzpsiqsce`), along with the twelve previously-pending migrations
that had never reached it. Staging went from 68 tables / 706 columns to
73 / 755.

Verified after the fact by re-dumping staging: `cliente_datas` (6 cols) and
`cliente_enderecos` (13 cols) carry the same **column names** as production, and
`clientes.data_aniversario` is present. The Endereços and Datas features are no
longer broken there.

⚠ **That verification was weaker than "match production exactly" implied, and an
earlier version of this paragraph said exactly that.** The check was a
column-inventory diff (`parse_schema.py`, which reduces a dump to
`table.column` lines), so it compares names and nothing else — not types,
nullability, defaults, or identity-vs-sequence. It therefore could not have
detected the divergence it was being cited as evidence against: migration 1
created both `id` columns as `GENERATED BY DEFAULT AS IDENTITY` while production
uses a sequence-owned `bigint`. Migration 7 exists to repair that, and staging
has not yet received it.

This is the third time in this effort that a conclusion outran the check
behind it. The general rule: **state the check, not the confidence** — "column
names match" is a claim a name diff can support; "matches exactly" is not.

**The drop migration was a complete no-op on staging** — every one of its
targets was already absent, so staging validates the adopt path only.

Evidence for the destructive path, stated precisely so the production decision
rests on the right facts:

- **Proven:** the mechanics. Against a throwaway Postgres 17 with fixtures
  carrying `subscription_events` rows and all seven target columns, the drops
  executed, the NOTICE counts reported correctly, and the post-condition
  assertion confirmed removal. Re-running was a clean no-op.
- **Not proven:** behaviour against production's actual data and dependency
  graph. The fixture was synthetic and minimal — it did not reproduce
  production's row volumes, foreign keys into these objects from tables the
  fixture omitted, or anything reading them outside the schema dump.

Production is therefore the first environment where this migration removes real
data. The dependency checks behind it were thorough (no referencing code, and no
dependent function, view, trigger or policy in the production schema dump), but
they are static analysis, not a live rehearsal.

## Decisions and migrations

All items are now ruled on. **Seven migrations.** Only the first two are applied
to staging; migrations 3–7 are written and tested but applied nowhere.

| # | Migration | Covers | Decision | Applied |
|---|---|---|---|---|
| 1 | `20260727000001_reconcile_adopt_client_tables` | `cliente_enderecos`, `cliente_datas`, `clientes.data_aniversario` | Adopt | staging |
| 2 | `20260727000002_reconcile_drop_unreferenced` | `subscription_events`, 6 `workspaces` billing cols, `instagram_accounts.updated_at` | Drop | staging (no-op) |
| 3 | `20260727000003_reconcile_adopt_contas_columns` | `contas.brand_color`, `contas.hub_enabled` | Keep + adopt | — |
| 4 | `20260727000004_reconcile_drop_google_drive_columns` | 3 × `files.google_drive_*` | Drop + rewrite constraints | — |
| 5 | `20260727000005_reconcile_add_missing_created_at` | 4 × `created_at` (Finding C) | Add, no backfill | — |
| 6 | `20260727000006_fix_cliente_tables_active_workspace_rls` | RLS on the two adopted tables | **Security fix** | — |
| 7 | `20260727000007_normalize_cliente_tables_shape` | `id` on both adopted tables | Normalize to prod's shape | — |

**Staging is not finished.** It has migrations 1–2 only, so it still needs 3–7 —
including 7, which is the one that repairs the identity-vs-sequence divergence
migration 1 introduced there. Treating the Status section below as "staging is
done" is wrong.

### Finding E — adopting production's RLS adopted a cross-workspace leak

Surfaced by external review of migration 1 and confirmed by live reproduction.

The adopted policies scope by *any* workspace the caller belongs to
(`conta_id IN (SELECT workspace_id FROM workspace_members WHERE user_id =
auth.uid())`), where every other tenant table scopes to the **active** workspace
via `get_my_conta_id()`. The client adds no tenant filter of its own:

- `getClienteEnderecos` / `getClienteDatas` filter only by `cliente_id`, and
  `ClienteDetalhePage` fires both off the `:id` route param regardless of
  whether the parent `clientes` row loaded. `clientes.id` is a globally
  sequential bigint, so `/clientes/<id-in-another-workspace>` renders that
  workspace's addresses and dates, with UPDATE/DELETE equally reachable.
- **`getAllClienteDatas()` has no filter at all** and feeds `CalendarioPage`, so
  a multi-workspace user's calendar passively shows other workspaces' client
  dates. No crafted URL needed — this is the default rendering.

Reproduced under real RLS (role impersonation via `SET LOCAL ROLE authenticated`
plus a JWT claim, since running as table owner bypasses RLS entirely): a user in
workspaces A and B with A active read a row belonging to B. After migration 6,
the same session sees only A's row, and UPDATE/DELETE against B's row affect
**0 rows** — checked by affected-row count, because RLS denies by filtering
rather than raising. Same-workspace INSERT and UPDATE still affect 1 row, so no
legitimate flow regresses.

The new predicate adds active-workspace scoping, which is the fix. It also
retains the membership clause, but only as belt-and-braces:
`get_my_conta_id()` has proven membership itself since `20260713000001`
(re-delivered to production by `20260720000004`), so the conjunct is redundant
rather than load-bearing. An earlier version of this section claimed the
`get_my_conta_id()`-only pattern proved no membership; that was read off the
superseded `20260315` definition and is withdrawn.

**This is a live defect in production, not one these migrations introduce.**
Migration 1 propagated it to staging and would carry it into every fresh
environment. It is fixed rather than deferred to the general hardening pass,
which covers a different issue.

### Accepted residual difference

Migration 5 adds the four `created_at` columns as **nullable with a default**,
not `NOT NULL DEFAULT now()` as the original definitions have them. Existing
rows keep `created_at IS NULL` — honestly "unknown" — rather than being stamped
with the migration date, which for `instagram_posts` and
`instagram_follower_history` would have fabricated creation times for thousands
of historical rows.

Production and staging will therefore still differ on the effective value for
pre-existing rows. This is a deliberate trade of exact schema parity for data
honesty, recorded here rather than left to be rediscovered as drift.

**Postgres gotcha this depends on:** in PG 11+,
`ADD COLUMN x timestamptz DEFAULT now()` populates every existing row with the
default. Leaving old rows NULL requires adding the column bare and attaching the
default in a second statement. Verified empirically — the single-statement form
backfilled 3 of 3 existing rows in a fixture; the two-statement form left all 3
NULL while new inserts still received a timestamp.

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
