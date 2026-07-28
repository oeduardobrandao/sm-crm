# Task 2 report — Migration A masking views (membros_v / clientes_v)

Note: this path previously held an unrelated report ("Embedded fonts pipeline") from a different
task numbering in a different worktree (`cliente-detalhe-floating-nav-b97521`,
`claude/analytics-conta-report-be880c`). Replaced with this task's report, per the instruction to
write to this exact path.

## Environment check

```
$ pwd
/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/analytics-conta-visual-design-3f5fc3
$ git branch --show-current
claude/mises-access-levels-c956a8
$ git status
On branch claude/mises-access-levels-c956a8
Your branch is ahead of 'origin/claude/mises-access-levels-c956a8' by 9 commits.
nothing to commit, working tree clean
```

Docker stack for this worktree (`supabase_db_analytics-conta-visual-design-3f5fc3`, port 54322)
was already running. Not linked to remote in this session — no `db push`, no `--linked`, no
`supabase link` was run.

## What I read before touching anything

- `.superpowers/sdd/task-2-brief.md` — the task spec, in full.
- `supabase/migrations/20260728000001_financial_visibility_a_additive.sql` (as it existed before my
  edit) — confirmed Task 1's content (column, predicate, realtime block) and the post-condition `DO
  $$` block's exact current shape/position, since the brief warned it had been revised by a later
  fix pass.
- `supabase/tests/entitlements/_helpers.sql` — confirmed `et_make_workspace(p_plan_id, overrides)`
  signature and that `et_grant_hosted_parity()` is a distinct, unneeded helper for this suite (my
  suite only reads `membros_v`/`clientes_v`, which the migration grants explicitly).
- `supabase/tests/entitlements/50_can_see_financials.sql` — confirmed the established idiom for
  impersonating a user (`set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`)
  and for the non-member fixture (`update profiles set active_workspace_id = null`).
- Base table shapes: grepped `supabase/migrations/` for every column the brief's views enumerate
  (`crm_user_id`, `especialidade`, `data_aniversario`, `dia_entrega`, `auto_publish_on_approval`,
  `send_report_email`, `include_ai_analysis`) to confirm each exists on `membros`/`clientes` before
  transcribing the `CREATE VIEW` statements — all confirmed present.
- `public.get_my_conta_id()` (`20260720000004_reconcile_prod_missing_functions.sql:25-41`) —
  confirmed it's the "hardened" version requiring a live `workspace_members` row for
  `active_workspace_id`, which is what makes the brief's stale-pointer test case meaningful (delete
  the membership, pointer still set → 0 rows, not an error).

No ambiguity found worth escalating — brief's SQL matched the schema on disk exactly, the resolved
ambiguities in the assignment (skip `et_grant_hosted_parity`, use `et_make_workspace('max')`, null
out `active_workspace_id` for non-members) all checked out against the actual helper/fixture code.

## What I implemented

1. Appended to `supabase/migrations/20260728000001_financial_visibility_a_additive.sql`, transcribed
   verbatim from the brief:
   - `CREATE OR REPLACE VIEW public.membros_v` (security_barrier, 10 allowlisted columns + masked
     `custo_mensal`), `WHERE m.conta_id = public.get_my_conta_id()`.
   - `CREATE OR REPLACE VIEW public.clientes_v` (security_barrier, 19 allowlisted columns + masked
     `valor_mensal`), `WHERE c.conta_id = public.get_my_conta_id()`.
   - `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` + `GRANT SELECT ... TO
     authenticated` on both views.
   - Placed *before* the existing post-condition `DO $$` block (which asserts the Task-1 column and
     `can_see_financials()` ACL), as instructed — the file now reads: column → predicate → realtime
     → **views + grants** → post-conditions.
   - Appended the second `DO $$` block (view-ACL assertions reading `relacl` directly) as a new,
     separate `DO $$ ... $$;` statement immediately after the existing post-condition block, matching
     the brief's SQL exactly (not merged into the existing block's body).
2. Created `supabase/tests/entitlements/51_financial_views.sql`, transcribed verbatim from the
   brief — masking (authorized vs. restricted admin), row-visibility-survives-masking, tenant
   isolation, stale-pointer (0 rows), and INSERT/UPDATE write-denial through both views.

No redesign of the brief's SQL. No changes to the test file's content.

## Step 3: run the test to verify it fails (before `db reset`)

Ran `./scripts/test-entitlements.sh` immediately after writing both files, deliberately *before*
`npx supabase db reset`, so the live DB still lacked the new views:

```
$ ./scripts/test-entitlements.sh
PASS supabase/tests/entitlements/01_effective_plan_limit.sql
PASS supabase/tests/entitlements/02_clientes_limit.sql
PASS supabase/tests/entitlements/03_workspace_scoped.sql
PASS supabase/tests/entitlements/04_sub_entity.sql
PASS supabase/tests/entitlements/05_more_count_limits.sql
PASS supabase/tests/entitlements/06_downgrade_keep_existing.sql
PASS supabase/tests/entitlements/10_effective_plan_feature.sql
PASS supabase/tests/entitlements/11_feature_triggers.sql
PASS supabase/tests/entitlements/20_storage_rpcs.sql
PASS supabase/tests/entitlements/30_hub_token_touch.sql
PASS supabase/tests/entitlements/31_hub_token_rotate_extend.sql
PASS supabase/tests/entitlements/40_cliente_tables_tenant_isolation.sql
PASS supabase/tests/entitlements/50_can_see_financials.sql
FAIL supabase/tests/entitlements/51_financial_views.sql
    CREATE FUNCTION
    CREATE FUNCTION
    BEGIN
    psql:.../supabase/tests/entitlements/51_financial_views.sql:119: ERROR:  relation "public.membros_v" does not exist
    LINE 1: select custo_mensal            from public.membros_v where n...
                                                ^
    QUERY:  select custo_mensal            from public.membros_v where nome = 'Fulano'
    CONTEXT:  PL/pgSQL function inline_code_block line 31 at SQL statement
----------------------------------------
ran=14  failures=1
```

Matches the brief's expected failure exactly: `relation "public.membros_v" does not exist`, and all
13 pre-existing suites (including `50_can_see_financials`) still pass.

## Step 4: apply and verify

```
$ npx supabase db reset
... (full migration replay, all prior migrations applied cleanly) ...
Applying migration 20260728000001_financial_visibility_a_additive.sql...
NOTICE (00000): added workspace_members to supabase_realtime
Seeding data from supabase/seed.sql...
Restarting containers...
Finished supabase db reset on branch main.
{"target":"local","version":"","message":"Reset local database."}
```

No exception raised by either post-condition `DO $$` block — the ACL assertions for
`membros_v`/`clientes_v` passed inline during the reset.

```
$ ./scripts/test-entitlements.sh
PASS supabase/tests/entitlements/01_effective_plan_limit.sql
PASS supabase/tests/entitlements/02_clientes_limit.sql
PASS supabase/tests/entitlements/03_workspace_scoped.sql
PASS supabase/tests/entitlements/04_sub_entity.sql
PASS supabase/tests/entitlements/05_more_count_limits.sql
PASS supabase/tests/entitlements/06_downgrade_keep_existing.sql
PASS supabase/tests/entitlements/10_effective_plan_feature.sql
PASS supabase/tests/entitlements/11_feature_triggers.sql
PASS supabase/tests/entitlements/20_storage_rpcs.sql
PASS supabase/tests/entitlements/30_hub_token_touch.sql
PASS supabase/tests/entitlements/31_hub_token_rotate_extend.sql
PASS supabase/tests/entitlements/40_cliente_tables_tenant_isolation.sql
PASS supabase/tests/entitlements/50_can_see_financials.sql
PASS supabase/tests/entitlements/51_financial_views.sql
----------------------------------------
ran=14  failures=0
```

`ran=14 failures=0` — matches the expected outcome exactly.

## Self-review

- **ACL evidence, checked directly (not `has_table_privilege`)**, matching the project constraint
  that ACL assertions must read `relacl` and not rely on privilege-check functions:

  ```
  $ psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  SELECT c.relname, array_to_string(c.relacl, ',') AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('membros_v','clientes_v');
  "
    relname   |                         acl
  ------------+-----------------------------------------------------
   clientes_v | postgres=arwdDxtm/postgres,authenticated=r/postgres
   membros_v  | postgres=arwdDxtm/postgres,authenticated=r/postgres
  ```

  Only the view owner (`postgres`) holds write privileges; `authenticated` holds `r` (SELECT) only;
  no `anon` or `service_role` entries at all — confirms both the REVOKE and the GRANT landed exactly
  as intended, and that the auto-updatable-view write-escape path is closed.
- Confirmed all 19 `clientes_v` / 10 `membros_v` columns exist on the base tables (grepped every
  migration that adds a non-baseline column) before transcribing — no invented columns, nothing
  `SELECT *`.
- Confirmed placement: views + grants sit between the realtime block and the (now two) `DO $$`
  post-condition blocks, matching "what is actually on disk" per the brief's own warning, not a
  guess from the brief's prose.
- Did not call `et_grant_hosted_parity()` anywhere in the new suite — the passing run confirms the
  environment note held: local grants from this migration alone were sufficient for `authenticated`
  to read through the views.
- Ran the full suite twice (pre-reset expected-fail, post-reset expected-pass) rather than only the
  new file, to catch any regression in the pre-existing 13 suites — none occurred.
- No frontend/TS files touched; this is a pure SQL change. `npm run test`/`tsc` are not applicable
  here, consistent with the brief's own verification list (`db reset` + `test-entitlements.sh`
  only). Did not run `npm run build`/`npm run test` since no `apps/**` or `packages/**` code changed.

## Deviations from the brief

None. Both the migration append and the test file are verbatim transcriptions of the brief's SQL.

## Files changed

- `supabase/migrations/20260728000001_financial_visibility_a_additive.sql` (appended: views, grants,
  second post-condition block)
- `supabase/tests/entitlements/51_financial_views.sql` (new)
- `.superpowers/sdd/task-2-report.md` (this report)

## Commit

```
$ git add supabase/migrations/20260728000001_financial_visibility_a_additive.sql \
    supabase/tests/entitlements/51_financial_views.sql .superpowers/sdd/task-2-report.md
$ git commit -m "feat(db): add membros_v/clientes_v masking views (Migration A, part 2)"
```

**Commit SHA:** filled in below after the commit.

## Status

DONE. `ran=14 failures=0`. Deliberate pre-reset failing run confirmed the exact expected error.
Post-reset run and direct `relacl` inspection both confirm `authenticated` has SELECT-only on
`membros_v`/`clientes_v`, `anon`/`service_role`/`PUBLIC` have nothing, and the views' owner (bypass
of base-table RLS) is closed off by the explicit `WHERE conta_id = get_my_conta_id()` on each view.
