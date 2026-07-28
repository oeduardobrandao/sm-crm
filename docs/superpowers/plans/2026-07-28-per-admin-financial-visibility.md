# Per-Admin Financial Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner grant or revoke financial-data access per admin, enforced in the database rather than only hidden in the UI.

**Architecture:** A `can_see_financials` boolean on `workspace_members` feeds a `SECURITY DEFINER` SQL predicate. That predicate is conjoined into the RLS policies of `transacoes`/`contratos`, and drives column-level `GRANT` revocation plus masking views for `membros.custo_mensal` and `clientes.valor_mensal`. The client reads through the views and plumbs the capability through `AuthContext`. Ships expand/contract: additive migration → client deploy → breaking migration → edge function → reveal toggle.

**Tech Stack:** Postgres 15 (Supabase), RLS + column privileges, Deno edge functions, React 19, TanStack Query, Vitest, pgTAP-style psql suites.

**Spec:** [`docs/superpowers/specs/2026-07-27-admin-financeiro-visibility-design.md`](../specs/2026-07-27-admin-financeiro-visibility-design.md) — read it before starting. This plan implements it; where they disagree, the spec wins.

## Global Constraints

- **Migration filenames need unique timestamp prefixes.** The `migration-version-guard` CI job fails the build on duplicates. This plan uses `20260728000001`–`20260728000003`; verify none exist before creating (`ls supabase/migrations/ | grep 20260728`).
- **Author migrations in ascending numeric order — never fill a lower-numbered slot after a higher one has been pushed.** `supabase db push` refuses out-of-order migrations without `--include-all`, and a migration that fails leaves everything numerically after it unreachable. This branch already lost a day to that: `20260727000008`'s guard refused on production and blocked five unrelated migrations behind it. The numbering here is deliberate — A = `…0001` (Task 1–2), B = `…0002` (Task 12), RPC = `…0003` (Task 13) — so authoring order, numeric order and apply order are the same sequence.
- **`SET search_path = public, pg_temp` on every new `SECURITY DEFINER` function**, and schema-qualify every relation inside it. This departs from the repo's existing convention deliberately — see Known Gap 7 in the spec.

  **Do not claim this closes temp-schema shadowing for the capability check.** It does not, and a migration comment asserting otherwise is a false statement about the code. `can_see_financials()` delegates workspace resolution to `public.get_my_conta_id()`, whose live definition (`20260720000004_reconcile_prod_missing_functions.sql:25-41`) is `SECURITY DEFINER` with a bare `SET search_path = public` and **unqualified** `profiles` / `workspace_members`. With `pg_temp` absent there it is searched first for relations, so `CREATE TEMP TABLE profiles(...)` still controls which workspace the predicate resolves — one call below ours. Hardening a shared function is out of scope here; the honest comment says the new function is hardened *and names the dependency that is not*.
- **Never `SELECT *` in a view definition.** A later base-table column would appear ungranted and unreviewed.
- **The capability is conjoined with the tenant check, never substituted for it.** `can_see_financials()` does not authorize a row's `conta_id`.
- **Wrap the predicate as `(SELECT public.can_see_financials())`** in policies so it hoists to an InitPlan instead of evaluating per row.
- **CI gates:** `npm run lint`, `npm run format:check`, `npm run build`, `npm run test` must all pass before pushing. Run `npm run format` to auto-fix.
- **New SQL suites must be numbered.** `scripts/test-entitlements.sh` globs `[0-9]*.sql` under `supabase/tests/entitlements/` only. The `50_`/`51_`/`52_` names here run under the existing glob; a differently-named file would be silently skipped. (Three unnumbered suites elsewhere in `supabase/tests/` are never executed — out of scope, tracked in the spec's Known Gaps.)
- **PL/pgSQL assertions must be NULL-safe, or they silently cannot fail.** A zero-row `SELECT … INTO` leaves every target variable NULL, `NULL <> 1` evaluates to NULL, and PL/pgSQL treats a NULL `IF` condition as **false** — so the guard never fires. Verified live:

  ```
  v_rows=<NULL>   if v_rows <> 1            -> GUARD DID NOT FIRE (vacuous)
                  if coalesce(v_rows,0) <> 1 -> fired (correct)
  ```

  This bit `51_financial_views.sql` in exactly the case it existed to catch: "the view masked the column but did not hide the row". Use `coalesce(x, <sentinel>) <> y` or `x IS DISTINCT FROM y` for every comparison against a variable that a zero-row query could leave NULL. `is not true` / `is not false` / `is not null` are already NULL-strict and are fine.

- **Every masking assertion needs a positive counterpart in the same suite.** "Restricted caller reads NULL" is also what a broken `WHERE`, a hidden row, or a hard-coded `NULL` projection produce. Without an authorized read of the same column proving it returns the real value, the pair does not distinguish masking from breakage.

- **Test fixtures must use `et_make_workspace('max')`, never `'start'`.** The `start` and `free` plans set `max_team_members = 1` and the `trg_limit_seats` trigger (`20260611130003`) enforces it, so a fixture seeding an owner + admin + agent into one workspace aborts with `plan_limit_exceeded:max_team_members` during setup — before it reaches the behaviour under test. `max` has `max_team_members = NULL` (unlimited).

### Local vs hosted table ACLs — call `et_grant_hosted_parity()` in any suite that impersonates `authenticated`

Measured 2026-07-28 against a local database and the production dump.

- **Hosted** Supabase projects carry a `pg_default_acl` granting ALL on new `public` tables to `anon`/`authenticated`/`service_role`. The production dump shows **70 tables** with `GRANT ALL ON TABLE … TO "authenticated"`, including migration-created ones such as `workspace_members`.
- **Local** CLI images set that default only for `supabase_admin`; for role `postgres` — which is what applies migrations — the default is `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), with no `arwd`.
- Result: locally, the **only** tables `authenticated` can read are the four carrying an explicit `GRANT` in a migration (`post_designs`, `design_asset_refs`, `ai_image_generations`, `designs`). Everything else returns `permission denied` under `SET LOCAL ROLE authenticated`.

**This is an environment difference, not a schema defect.** Do not "fix" it by adding grants to migrations: that would single out a couple of tables while 68 others rely on the same implicit mechanism, and would misrepresent a local-image quirk as a production bug. An earlier draft of this section drew the opposite conclusion from an incomplete sample — it inferred from `clientes`/`membros` alone that production's grants were applied out-of-band. `workspace_members` disproves that: it is migration-created and carries the same grant.

Use the harness helper instead. `supabase/tests/entitlements/_helpers.sql` provides:

```sql
select et_grant_hosted_parity();                              -- all public tables
select et_grant_hosted_parity(ARRAY['membros','clientes']);   -- except these
```

It grants table privileges and sequence `USAGE` (needed separately — `nextval()` on a column default is checked against the caller). `p_exclude` exists because **a suite asserting a REVOKE must exclude the affected tables, or the helper silently undoes the assertion.**

| Suite | Needs parity? |
|---|---|
| `50_` (Task 1) | No — calls only `can_see_financials()`, whose EXECUTE grant is explicit in the migration |
| `51_` (Task 2) | No — reads `membros_v`/`clientes_v`, which are explicitly granted; a non-`security_invoker` view reads its base tables as the view owner |
| `52_` (Task 12) | **Yes** — `select et_grant_hosted_parity(ARRAY['membros','clientes'])`. The dependant assertions read `instagram_accounts` and `hub_brand` directly, and the `transacoes`/`contratos` policies need no parity because `get_my_conta_id()` and `can_see_financials()` are both `SECURITY DEFINER`. `membros`/`clientes` are excluded because Migration B's column-level grants on them are precisely what the suite asserts. |

Do not assert the **pre**-Migration-B baseline. It exists only on hosted projects, and no suite here is for it.
- **`git checkout -- deno.lock`** after running `npm run test:functions` — it always dirties the root lockfile.
- **Roles are `owner | admin | agent`**, always read via `AuthContext`, never hardcoded.
- **Portuguese UI copy.** All user-facing strings in pt-BR.

## Column allowlists (verified 2026-07-28 against production)

These are exact. Regenerate and diff before Task 12 (step included there) — any column added to either table between now and then would otherwise vanish from the CRM.

```
clientes  (20 cols) — allowlist omits valor_mensal (19):
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis

membros   (11 cols) — allowlist omits custo_mensal (10):
  id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento,
  created_at, crm_user_id
```

## File Structure

**Database**
- Create: `supabase/migrations/20260728000001_financial_visibility_a_additive.sql` — column, predicate, views, realtime
- Create: `supabase/migrations/20260728000003_set_financial_access_rpc.sql` — atomic setter RPC
- Create: `supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql` — revokes, grants, policies, triggers
- Create: `supabase/tests/entitlements/50_can_see_financials.sql` — predicate truth table
- Create: `supabase/tests/entitlements/51_financial_views.sql` — view masking, tenant isolation, ACLs
- Create: `supabase/tests/entitlements/52_financial_enforcement.sql` — policies, grants, triggers, dependants
- Create: `scripts/rollback-migration-b.sql`, `scripts/teardown-financial-visibility.sql`

**Client — capability plumbing**
- Create: `apps/crm/src/lib/financialAccess.ts` — `FinancialAccess` type + `formatFinancialBRL`
- Modify: `apps/crm/src/context/AuthContext.tsx` — `workspaceRole`, `canSeeFinancials`, revocation subscription
- Modify: `apps/crm/src/components/layout/nav-data.ts` — capability-aware nav
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` — financial route guard
- Create: `apps/crm/src/components/layout/FinancialRestrictionScreen.tsx`

**Client — data + pages**
- Modify: `apps/crm/src/store/team.ts`, `apps/crm/src/store/clients.ts`, `apps/crm/src/store/workspace.ts`
- Modify: `apps/crm/src/services/analytics.ts`
- Modify: page components listed per task

**Edge function**
- Create: `supabase/functions/manage-workspace-user/setFinancialAccess.ts` — DI handler
- Modify: `supabase/functions/manage-workspace-user/index.ts` — wire the action

---

### Task 1: Migration A — capability column and predicate

**Files:**
- Create: `supabase/migrations/20260728000001_financial_visibility_a_additive.sql`
- Create: `supabase/tests/entitlements/50_can_see_financials.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `public.can_see_financials() RETURNS boolean` — callable by `authenticated` only. Column `workspace_members.can_see_financials boolean NOT NULL DEFAULT true`.

- [ ] **Step 1: Confirm the migration slot is free**

```bash
ls supabase/migrations/ | grep 20260728 || echo "slot free"
```

Expected: `slot free`

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260728000001_financial_visibility_a_additive.sql`:

```sql
-- =============================================================
-- Per-admin financial visibility — Migration A (ADDITIVE, inert)
-- See docs/superpowers/specs/2026-07-27-admin-financeiro-visibility-design.md
--
-- Nothing here changes behaviour for a deployed client: no base-table privilege
-- is revoked and no existing policy is touched. The only revokes are FROM PUBLIC
-- and named roles on objects this migration itself creates.
-- =============================================================

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS can_see_financials boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspace_members.can_see_financials IS
  'Meaningful for role=admin only. Owners always see financials; agents never do. '
  'Default true so existing admins are unaffected on deploy.';

-- -------------------------------------------------------------
-- The predicate.
--
-- Reads workspace_members, NOT profiles: profiles.role goes stale on workspace
-- switch (no switch path writes it), which would make an owner in workspace A
-- read as owner in workspace B where they are an agent.
--
-- pg_temp is named LAST and every relation is schema-qualified. Without both, a
-- caller able to run CREATE TEMP TABLE workspace_members(...) could shadow the
-- real table and dictate this function's answer — PostgreSQL searches the
-- session temp schema FIRST for relation names when pg_temp is absent from the
-- path.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE wm.role
    WHEN 'owner' THEN true
    WHEN 'admin' THEN wm.can_see_financials
    ELSE false
  END
  FROM public.workspace_members AS wm
  WHERE wm.user_id = auth.uid()
    AND wm.workspace_id = public.get_my_conta_id();
$$;

-- Supabase's default privileges grant new objects in `public` directly to anon,
-- authenticated and service_role. REVOKE FROM PUBLIC alone leaves those intact,
-- so the named roles must be enumerated.
REVOKE ALL ON FUNCTION public.can_see_financials()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_financials() TO authenticated;

-- -------------------------------------------------------------
-- Realtime: the revocation subscription in AuthContext silently never fires
-- unless workspace_members is in the publication. No migration adds it today.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'workspace_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
    RAISE NOTICE 'added workspace_members to supabase_realtime';
  ELSE
    RAISE NOTICE 'workspace_members already in supabase_realtime';
  END IF;
END $$;

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  acl text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='workspace_members'
      AND column_name='can_see_financials'
      AND is_nullable='NO' AND column_default='true'
  ) THEN
    RAISE EXCEPTION 'can_see_financials column missing or wrong shape';
  END IF;

  SELECT array_to_string(p.proacl, ',') INTO acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='can_see_financials';

  IF acl IS NULL OR acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'can_see_financials(): authenticated lacks EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%anon=X%' THEN
    RAISE EXCEPTION 'can_see_financials(): anon retains EXECUTE — acl=%', acl;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='workspace_members'
  ) THEN
    RAISE EXCEPTION 'workspace_members not in supabase_realtime publication';
  END IF;
END $$;
```

- [ ] **Step 3: Write the failing test**

Create `supabase/tests/entitlements/50_can_see_financials.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Predicate truth table for can_see_financials().
--
-- IMPORTANT: these assertions must impersonate `authenticated`, not merely set
-- a JWT claim. Claims alone are enough for a SECURITY DEFINER function reading
-- auth.uid(), but the test session runs as the table owner, who bypasses RLS and
-- column privileges — a claims-only test would pass with the policies reverted.

begin;
do $$
declare
  v_ws    uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_none  uuid := gen_random_uuid();
  v_got   boolean;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin), (v_agent), (v_none);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent);

  -- v_none must be made a genuine non-participant, and inserting them into
  -- auth.users is NOT enough. That insert fires handle_new_user_workspace()
  -- (20260317_multi_workspace.sql), which auto-creates a throwaway workspace
  -- and makes the new user its OWNER. Verified live on a fresh local database:
  -- memberships=1, role=owner, active_workspace_id NOT NULL. Left alone,
  -- v_none is an owner of their own workspace and the predicate correctly
  -- returns true — the assertion below would fail for a reason that has
  -- nothing to do with the code under test.
  --
  -- Null the pointer instead of deleting the membership:
  -- trg_validate_active_workspace forbids active_workspace_id pointing at a
  -- workspace the user does not belong to, so "member of nothing, pointing
  -- somewhere" is unreachable by construction. Same precedent as
  -- 31_hub_token_rotate_extend.sql:34.
  update profiles set active_workspace_id = null where id = v_none;

  -- owner: true regardless of the flag
  update workspace_members set can_see_financials = false
   where user_id = v_owner and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'owner with flag=false should still see financials, got %', v_got;
  end if;

  -- admin: follows the flag (true)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not true then
    raise exception 'admin with default flag should see financials, got %', v_got;
  end if;

  -- admin: follows the flag (false)
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'restricted admin should not see financials, got %', v_got;
  end if;

  -- agent: false regardless of the flag
  update workspace_members set can_see_financials = true
   where user_id = v_agent and workspace_id = v_ws;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not false then
    raise exception 'agent with flag=true should NOT see financials, got %', v_got;
  end if;

  -- No active workspace: NULL, which fails closed in an RLS USING clause.
  -- (The other NULL-yielding case — membership deleted while
  -- active_workspace_id still points at the workspace — is the stale-pointer
  -- assertion in 51_financial_views.sql.)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.can_see_financials() into v_got;
  reset role;
  if v_got is not null then
    raise exception 'user with no active workspace should get NULL, got %', v_got;
  end if;

  raise notice '50_can_see_financials: all predicate cases passed';
end $$;
rollback;

-- Anonymous cannot execute the helper.
begin;
do $$
declare v_ok boolean := false;
begin
  set local role anon;
  begin
    perform public.can_see_financials();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'anon must not be able to execute can_see_financials()';
  end if;
  raise notice '50_can_see_financials: anon correctly denied';
end $$;
rollback;
```

- [ ] **Step 4: Run the test to verify it fails**

The local Supabase stack must be running. If port 54322 is held by another project, stop that stack first.

```bash
npx supabase start && ./scripts/test-entitlements.sh
```

Expected: `FAIL supabase/tests/entitlements/50_can_see_financials.sql` with `function public.can_see_financials() does not exist`.

- [ ] **Step 5: Apply the migration locally**

```bash
npx supabase db reset
```

Expected: all migrations apply; `NOTICE: added workspace_members to supabase_realtime`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
./scripts/test-entitlements.sh
```

Expected: `PASS supabase/tests/entitlements/50_can_see_financials.sql`, and every pre-existing suite still PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260728000001_financial_visibility_a_additive.sql supabase/tests/entitlements/50_can_see_financials.sql
git commit -m "feat(db): add can_see_financials column and predicate (Migration A, part 1)"
```

---

### Task 2: Migration A — masking views

**Files:**
- Modify: `supabase/migrations/20260728000001_financial_visibility_a_additive.sql` (append)
- Create: `supabase/tests/entitlements/51_financial_views.sql`

**Interfaces:**
- Consumes: `public.can_see_financials()`, `public.get_my_conta_id()` from Task 1
- Produces: `public.membros_v` (10 allowlisted columns + masked `custo_mensal`), `public.clientes_v` (19 allowlisted columns + masked `valor_mensal`). Both `SELECT`-only to `authenticated`.

- [ ] **Step 1: Append the views to the migration**

Add to the end of `supabase/migrations/20260728000001_financial_visibility_a_additive.sql`, **before** the post-condition block (move that block to the bottom):

```sql
-- -------------------------------------------------------------
-- Masking views.
--
-- security_invoker is IMPOSSIBLE here: an invoker view evaluates the CASE with
-- the caller's privileges, so the caller would need SELECT on the very column
-- Migration B revokes. The view owner therefore bypasses base-table RLS, which
-- makes the explicit WHERE the ONLY tenant isolation on this path — it must
-- never be removed in favour of "RLS handles it".
--
-- Columns are enumerated, never SELECT *: a new base-table column would
-- otherwise appear here ungranted and unreviewed.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW public.membros_v WITH (security_barrier = true) AS
  SELECT m.id, m.user_id, m.conta_id, m.nome, m.cargo, m.tipo,
         m.avatar_url, m.data_pagamento, m.created_at, m.crm_user_id,
         CASE WHEN public.can_see_financials()
              THEN m.custo_mensal ELSE NULL END AS custo_mensal
  FROM public.membros m
  WHERE m.conta_id = public.get_my_conta_id();

CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

-- The enumerated revoke is SECURITY-CRITICAL, not tidiness. These views are
-- auto-updatable on their simple columns, their owner bypasses base-table RLS,
-- and they carry no CHECK OPTION. Left with Supabase's default write grants to
-- `authenticated`, a caller could INSERT a row with an arbitrary conta_id, or
-- UPDATE an existing row's conta_id into another workspace — writing straight
-- past every policy this design relies on.
--
-- NOT granted to service_role, and the reason is stronger than "they would see
-- masked values": EXECUTE on a function is checked against the CURRENT USER
-- even inside a non-security_invoker view, so a service_role client selecting
-- this view hits permission denied on can_see_financials() given its REVOKE.
-- Edge functions must keep reading base tables, where their grants are
-- untouched. Do NOT "fix" this by granting EXECUTE to service_role.
--
-- NOT granted to service_role: trusted callers have no auth.uid(), so they
-- would get masked values and zero rows. Edge functions read base tables
-- directly, where their grants are untouched.
REVOKE ALL ON public.membros_v  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.clientes_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membros_v  TO authenticated;
GRANT SELECT ON public.clientes_v TO authenticated;
```

Then extend the post-condition block at the bottom with:

```sql
DO $$
DECLARE
  v      text;
  acl    text;
BEGIN
  FOREACH v IN ARRAY ARRAY['membros_v', 'clientes_v'] LOOP
    SELECT array_to_string(c.relacl, ',') INTO acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname=v;

    IF acl IS NULL OR acl NOT LIKE '%authenticated=r/%' THEN
      RAISE EXCEPTION '%: authenticated lacks SELECT — acl=%', v, acl;
    END IF;
    -- 'a' = INSERT, 'w' = UPDATE, 'd' = DELETE. Any of them on authenticated is
    -- the auto-updatable-view escape path this design exists to close.
    IF acl ~ ('authenticated=[rwad]*[awd]') THEN
      RAISE EXCEPTION '%: authenticated retains write privilege — acl=%', v, acl;
    END IF;
    IF acl LIKE '%anon=%' THEN
      RAISE EXCEPTION '%: anon retains privilege — acl=%', v, acl;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/entitlements/51_financial_views.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Masking, tenant isolation and write-denial on membros_v / clientes_v.

begin;
do $$
declare
  v_ws_a  uuid; v_ws_b uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_val   numeric;
  v_rows  bigint;
  v_ok    boolean;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'),
    (v_admin, v_ws_a, 'admin');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin);

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_a, 'Fulano', 'Designer', 'clt', 5000, '');
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_b, 'Outro WS', 'Dev', 'clt', 9999, '');
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_owner, v_ws_a, 'Cliente A', 'CA', '#000', 3000);

  -- authorized admin sees the real values
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal into v_val from public.membros_v where nome = 'Fulano';
  reset role;
  if v_val is distinct from 5000 then
    raise exception 'authorized admin should read custo_mensal=5000, got %', v_val;
  end if;

  -- restricted admin sees NULL, but still sees the ROW
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal, count(*) over () into v_val, v_rows
    from public.membros_v where nome = 'Fulano';
  reset role;
  if v_rows <> 1 then
    raise exception 'restricted admin must still SEE the member row, got % rows', v_rows;
  end if;
  if v_val is not null then
    raise exception 'restricted admin should read custo_mensal=NULL, got %', v_val;
  end if;

  -- clientes_v masks the same way
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor_mensal into v_val from public.clientes_v where nome = 'Cliente A';
  reset role;
  if v_val is not null then
    raise exception 'restricted admin should read valor_mensal=NULL, got %', v_val;
  end if;

  -- tenant isolation: workspace B's member is invisible through the view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v where nome = 'Outro WS';
  reset role;
  if v_rows <> 0 then
    raise exception 'view leaked workspace B rows: % found', v_rows;
  end if;

  -- stale pointer: membership deleted while active_workspace_id still points there
  delete from workspace_members where user_id = v_admin and workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v;
  reset role;
  if v_rows <> 0 then
    raise exception 'stale active_workspace_id must yield 0 rows, got %', v_rows;
  end if;

  -- writes through the view are denied for authenticated
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into public.membros_v (nome, cargo, tipo, conta_id, avatar_url)
      values ('Injetado', 'X', 'clt', v_ws_b, '');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'INSERT through membros_v must be denied for authenticated';
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    update public.membros_v set conta_id = v_ws_b where nome = 'Fulano';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'UPDATE through membros_v must be denied for authenticated';
  end if;

  raise notice '51_financial_views: all view cases passed';
end $$;
rollback;
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
./scripts/test-entitlements.sh
```

Expected: `FAIL … 51_financial_views.sql` with `relation "public.membros_v" does not exist`.

- [ ] **Step 4: Apply and verify**

```bash
npx supabase db reset && ./scripts/test-entitlements.sh
```

Expected: `PASS` on `50_`, `51_`, and every pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000001_financial_visibility_a_additive.sql supabase/tests/entitlements/51_financial_views.sql
git commit -m "feat(db): add membros_v/clientes_v masking views (Migration A, part 2)"
```

---

### Task 3: `formatFinancialBRL` and the capability type

**Files:**
- Create: `apps/crm/src/lib/financialAccess.ts`
- Create: `apps/crm/src/lib/__tests__/financialAccess.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type FinancialAccess = boolean | 'unknown'`; `formatFinancialBRL(val: number | null | undefined, access: FinancialAccess): string`. Every later task imports both from `@/lib/financialAccess`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/financialAccess.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatFinancialBRL, MASKED_BRL } from '../financialAccess';

describe('formatFinancialBRL', () => {
  it('formats the value when access is literally true', () => {
    expect(formatFinancialBRL(1234.5, true)).toBe(
      (1234.5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    );
  });

  it('masks when access is false', () => {
    expect(formatFinancialBRL(1234.5, false)).toBe(MASKED_BRL);
  });

  // Values fail CLOSED: rendering a real figure to someone who may be
  // restricted is the harm, so anything that is not literal `true` masks.
  it('masks while access is still unknown', () => {
    expect(formatFinancialBRL(1234.5, 'unknown')).toBe(MASKED_BRL);
  });

  it('treats null and undefined as zero when authorized', () => {
    const zero = (0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(formatFinancialBRL(null, true)).toBe(zero);
    expect(formatFinancialBRL(undefined, true)).toBe(zero);
  });

  it('masks null when not authorized rather than showing R$ 0', () => {
    expect(formatFinancialBRL(null, false)).toBe(MASKED_BRL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- financialAccess
```

Expected: FAIL — `Failed to resolve import "../financialAccess"`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/financialAccess.ts`:

```ts
/**
 * Whether the current user may see financial values.
 *
 * `'unknown'` is a real, distinct state — not a placeholder. It means the
 * membership lookup has not resolved (hydration in flight, or a transient
 * failure). A bare boolean is unsafe in both directions: defaulting `true`
 * briefly exposes restricted values from cache, defaulting `false` renders
 * restriction UI at owners.
 */
export type FinancialAccess = boolean | 'unknown';

export const MASKED_BRL = 'R$ •••••';

/**
 * Format a monetary value, masking unless access is explicitly granted.
 *
 * Fails CLOSED: anything that is not literal `true` masks, because rendering a
 * real figure to someone who may be restricted is the harm. (The route guard
 * fails *neutral* instead — see AppLayout.)
 *
 * Replaces `formatBRL` from store/core.ts, which read a mutable module global
 * (`currentUserRole`) that is not reactive and goes stale after live revocation
 * or sign-out. An explicit parameter cannot go stale.
 */
export function formatFinancialBRL(
  val: number | null | undefined,
  access: FinancialAccess,
): string {
  if (access !== true) return MASKED_BRL;
  return (val ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- financialAccess
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/financialAccess.ts apps/crm/src/lib/__tests__/financialAccess.test.ts
git commit -m "feat(crm): add formatFinancialBRL and FinancialAccess type"
```

---

### Task 4: AuthContext exposes `workspaceRole` and `canSeeFinancials`

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx`
- Modify: `apps/crm/src/store/workspace.ts`
- Create: `apps/crm/src/store/__tests__/membership.test.ts`

**Interfaces:**
- Consumes: `FinancialAccess` from Task 3
- Produces: `getMyMembership(): Promise<{ role: 'owner'|'admin'|'agent'; can_see_financials: boolean } | null>` from `@/store/workspace`; `useAuth()` gains `workspaceRole: 'owner'|'admin'|'agent'|null` and `canSeeFinancials: FinancialAccess`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/store/__tests__/membership.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockGetContaId = vi.fn();

vi.mock('../core', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      }),
    }),
  },
  getContaId: mockGetContaId,
  getUserId: vi.fn().mockResolvedValue('u1'),
}));

import { getMyMembership } from '../workspace';

describe('getMyMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
  });

  it('returns the membership row for the active workspace', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'admin', can_see_financials: false },
      error: null,
    });
    await expect(getMyMembership()).resolves.toEqual({
      role: 'admin',
      can_see_financials: false,
    });
  });

  it('returns null when there is no membership row', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getMyMembership()).resolves.toBeNull();
  });

  it('throws on a query error so the caller can resolve to unknown', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMyMembership()).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- membership
```

Expected: FAIL — `getMyMembership is not a function`.

- [ ] **Step 3: Add `getMyMembership` to the store**

Append to `apps/crm/src/store/workspace.ts`:

```ts
export interface MyMembership {
  role: 'owner' | 'admin' | 'agent';
  can_see_financials: boolean;
}

/**
 * The caller's membership row for the ACTIVE workspace.
 *
 * Read from workspace_members rather than profiles: no workspace-switch path
 * writes profiles.role, so a user who is owner in A and agent in B keeps
 * `owner` after switching. This is the same staleness the SQL predicate avoids.
 *
 * Throws on a query error — the caller must be able to tell "no membership"
 * (null) from "could not determine" (throw), because those resolve to different
 * capability states.
 */
export async function getMyMembership(): Promise<MyMembership | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const conta_id = await getContaId();
  if (!conta_id) return null;

  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, can_see_financials')
    .eq('user_id', user.id)
    .eq('workspace_id', conta_id)
    .maybeSingle();

  if (error) throw error;
  return (data as MyMembership | null) ?? null;
}
```

Check the top of `workspace.ts` imports `getContaId` from `./core`; add it to the existing import if absent.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- membership
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into AuthContext**

In `apps/crm/src/context/AuthContext.tsx`:

Add the import:

```ts
import { getMyMembership } from '../store/workspace';
import type { FinancialAccess } from '../lib/financialAccess';
```

Extend the context interface (currently at `:23-30`):

```ts
interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  role: 'owner' | 'admin' | 'agent';
  /**
   * Role from workspace_members for the ACTIVE workspace. Prefer this over
   * `role` for anything permission-bearing; `role` comes from profiles and goes
   * stale on workspace switch. `null` while unresolved.
   */
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
  canSeeFinancials: FinancialAccess;
  loading: boolean;
  refetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
```

Add state next to the existing `useState` calls (`:36-38`):

```ts
const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'admin' | 'agent' | null>(null);
const [canSeeFinancials, setCanSeeFinancials] = useState<FinancialAccess>('unknown');
```

In the profile effect, add the membership fetch immediately after the existing
`await initStoreRole();` (`:126`), inside the same `try` and the same
`profileRequestId` guard:

```ts
        await initStoreRole();
        if (!active || profileRequestId.current !== requestId) return;

        // Joins the existing guarded hydration flow so `loading` covers it too.
        // On failure resolve to 'unknown', NEVER to a boolean.
        try {
          const membership = await getMyMembership();
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(membership?.role ?? null);
          setCanSeeFinancials(membership ? membership.can_see_financials : 'unknown');
        } catch {
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(null);
          setCanSeeFinancials('unknown');
        }
```

In the `!userId` early-return branch (`:99-103`) and in `signOut`, reset both:

```ts
      setWorkspaceRole(null);
      setCanSeeFinancials('unknown');
```

Add both to the provider value (`:186-188`):

```tsx
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        workspaceRole,
        canSeeFinancials,
        loading,
        refetchProfile: fetchProfile,
        signOut,
      }}
    >
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
```

Expected: no TypeScript errors.

```bash
git add apps/crm/src/context/AuthContext.tsx apps/crm/src/store/workspace.ts apps/crm/src/store/__tests__/membership.test.ts
git commit -m "feat(crm): expose workspaceRole and canSeeFinancials from AuthContext"
```

---

### Task 5: Capability-aware navigation

**Files:**
- Modify: `apps/crm/src/components/layout/nav-data.ts:203-256`
- Create: `apps/crm/src/components/layout/__tests__/nav-data.test.ts`
- Modify: callers of `getNavGroups` / `getMoreSheetGroups`

**Interfaces:**
- Consumes: `FinancialAccess` from Task 3
- Produces: `getNavGroups(role: string, features: Record<string, boolean> | null, canSeeFinancials: FinancialAccess): NavGroup[]`. `getMoreSheetGroups` takes the same three parameters.

**The capability parameter is REQUIRED, not defaulted.** A default of `true` would be a fail-open default: any future call site that forgets the argument silently shows financial nav to a restricted admin, and TypeScript would not complain. Making it required means Step 5 below is enforced by the compiler rather than by memory — `npm run build` fails until every call site passes it.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/layout/__tests__/nav-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getNavGroups, getMoreSheetGroups } from '../nav-data';

const ids = (groups: ReturnType<typeof getNavGroups>) =>
  groups.flatMap((g) => g.items.map((i) => i.id));

describe('getNavGroups financial capability', () => {
  it('shows financeiro and contratos to an authorized admin', () => {
    const got = ids(getNavGroups('admin', null, true));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('hides financeiro and contratos from a restricted admin', () => {
    const got = ids(getNavGroups('admin', null, false));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Nav fails closed alongside values: an unresolved capability must not flash
  // financial nav items at a restricted admin.
  it('hides them while the capability is unknown', () => {
    const got = ids(getNavGroups('admin', null, 'unknown'));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('always shows them to an owner, even with the flag false', () => {
    const got = ids(getNavGroups('owner', null, false));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('keeps equipe for an authorized admin', () => {
    expect(ids(getNavGroups('admin', null, true))).toContain('equipe');
  });

  // Pre-existing mismatch this task fixes: ProtectedRoute blocks agents from
  // /equipe, but nav-data kept rendering the link, so agents saw an item that
  // bounced them to /dashboard.
  it('hides equipe from agents, who are route-blocked from it', () => {
    expect(ids(getNavGroups('agent', null, true))).not.toContain('equipe');
  });

  it('still hides leads and financials from agents', () => {
    const got = ids(getNavGroups('agent', null, true));
    expect(got).not.toContain('leads');
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('applies the capability to the more-sheet too', () => {
    expect(ids(getMoreSheetGroups('admin', null, false))).not.toContain('financeiro');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- nav-data
```

Expected: FAIL on the restricted-admin, unknown, and agent-equipe cases.

- [ ] **Step 3: Update `nav-data.ts`**

Replace `getNavGroups` and `getMoreSheetGroups` (`:203-256`) with:

```ts
export function getNavGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
): NavGroup[] {
  let groups = ALL_NAV_GROUPS;

  // Billing is owner-only.
  if (role !== 'owner') {
    groups = groups.map((g) =>
      g.id === 'config' ? { ...g, items: g.items.filter((i) => i.id !== 'cobranca') } : g,
    );
  }

  if (role === 'agent') {
    groups = groups
      .map((g) => {
        if (g.id === 'crm') return { ...g, items: g.items.filter((i) => i.id !== 'leads') };
        if (g.id === 'gestao')
          return {
            ...g,
            // `equipe` is included because ProtectedRoute redirects agents away
            // from /equipe. Leaving the link visible rendered an item that
            // bounced them to /dashboard.
            items: g.items.filter(
              (i) => i.id !== 'financeiro' && i.id !== 'contratos' && i.id !== 'equipe',
            ),
          };
        return g;
      })
      .filter((g) => g.items.length > 0);
  }

  // Restricted admins lose the financial routes. Owners are never restricted,
  // and agents already lost them above.
  //
  // Fails CLOSED on 'unknown', matching formatFinancialBRL: flashing a nav item
  // that then bounces to a restriction screen is worse than a brief absence.
  if (role !== 'owner' && canSeeFinancials !== true) {
    groups = groups
      .map((g) =>
        g.id === 'gestao'
          ? { ...g, items: g.items.filter((i) => i.id !== 'financeiro' && i.id !== 'contratos') }
          : g,
      )
      .filter((g) => g.items.length > 0);
  }

  // Hide feature-gated nav items when the flag is explicitly false.
  if (features) {
    groups = groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          const flag = NAV_FEATURE[i.id];
          return !flag || features[flag] !== false;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }

  return groups;
}

export function getMoreSheetGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
): NavGroup[] {
  return getNavGroups(role, features, canSeeFinancials)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !PRIMARY_NAV_IDS.includes(i.id)),
    }))
    .filter((g) => g.items.length > 0);
}
```

Add at the top of the file:

```ts
import type { FinancialAccess } from '@/lib/financialAccess';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- nav-data
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Pass the capability at every call site**

```bash
grep -rn "getNavGroups(\|getMoreSheetGroups(" apps/crm/src --include='*.tsx' --include='*.ts' | grep -v __tests__ | grep -v "nav-data.ts"
```

In each component the grep reports, read `canSeeFinancials` from `useAuth()` and pass it as the third argument. Example for `Sidebar.tsx`:

```tsx
const { role, canSeeFinancials } = useAuth();
const groups = getNavGroups(role, features, canSeeFinancials);
```

- [ ] **Step 6: Verify the whole suite and typecheck**

```bash
npm run test && npm run build
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/components/layout/nav-data.ts apps/crm/src/components/layout/__tests__/nav-data.test.ts
git add -u apps/crm/src
git commit -m "feat(crm): hide financial nav from restricted admins, fix equipe for agents"
```

---

### Task 6: Financial route guard

**Files:**
- Create: `apps/crm/src/components/layout/FinancialRestrictionScreen.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx`
- Create: `apps/crm/src/components/layout/__tests__/financialRouteGuard.test.ts`

**Interfaces:**
- Consumes: `FinancialAccess` from Task 3, `canSeeFinancials` from Task 4
- Produces: `FINANCIAL_PATHS: string[]`, `isFinancialPath(pathname: string): boolean` exported from `AppLayout.tsx`; `<FinancialRestrictionScreen />`.

**Why the split:** `ProtectedRoute` wraps `AppLayout` (`App.tsx:141-147`), so anything it returns replaces the entire application shell. That is correct for the agent redirect (`ProtectedRoute.tsx:8,39-41`, unchanged by this task) and wrong for a restriction screen, which must keep sidebar and nav. A single implementation in either component breaks the other case.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/layout/__tests__/financialRouteGuard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isFinancialPath, financialGuardOutcome } from '../AppLayout';

describe('isFinancialPath', () => {
  it('matches the financial routes and their children', () => {
    expect(isFinancialPath('/financeiro')).toBe(true);
    expect(isFinancialPath('/contratos')).toBe(true);
    expect(isFinancialPath('/contratos/42')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isFinancialPath('/dashboard')).toBe(false);
    expect(isFinancialPath('/equipe')).toBe(false);
    expect(isFinancialPath('/clientes/1')).toBe(false);
  });
});

describe('financialGuardOutcome', () => {
  it('renders content on a non-financial route regardless of capability', () => {
    expect(financialGuardOutcome('/dashboard', false)).toBe('content');
    expect(financialGuardOutcome('/dashboard', 'unknown')).toBe('content');
  });

  it('renders content on a financial route when authorized', () => {
    expect(financialGuardOutcome('/financeiro', true)).toBe('content');
  });

  it('denies on a financial route when explicitly restricted', () => {
    expect(financialGuardOutcome('/financeiro', false)).toBe('denied');
  });

  // The route screen fails NEUTRAL, unlike value masking which fails closed.
  // Writing this as `!== true` would show an owner the restriction screen during
  // hydration or a transient membership-lookup failure. The loading state leaks
  // nothing: route content is unrendered either way and the database denies
  // regardless.
  it('shows loading, not denial, while the capability is unknown', () => {
    expect(financialGuardOutcome('/financeiro', 'unknown')).toBe('loading');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- financialRouteGuard
```

Expected: FAIL — `isFinancialPath is not exported`.

- [ ] **Step 3: Write the restriction screen**

Create `apps/crm/src/components/layout/FinancialRestrictionScreen.tsx`:

```tsx
import { Lock } from 'lucide-react';

/**
 * Shown inside AppLayout's <Outlet /> slot, so the sidebar and nav survive.
 * Deliberately not a redirect: a silent bounce to /dashboard leaves the user
 * with no idea why the page they clicked did not open.
 */
export default function FinancialRestrictionScreen() {
  return (
    <div className="page-content">
      <div
        className="card"
        style={{ maxWidth: 520, margin: '3rem auto', textAlign: 'center' }}
      >
        <Lock size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3 style={{ marginBottom: '0.75rem' }}>Acesso financeiro restrito</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          O proprietário do workspace desativou seu acesso aos dados financeiros.
          Fale com ele se você precisa visualizar esta área.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the guard to `AppLayout.tsx`**

Add near the top of `apps/crm/src/components/layout/AppLayout.tsx`:

```tsx
import { useAuth } from '../../context/AuthContext';
import type { FinancialAccess } from '../../lib/financialAccess';
import FinancialRestrictionScreen from './FinancialRestrictionScreen';
import { Spinner } from '../ui/spinner';

export const FINANCIAL_PATHS = ['/financeiro', '/contratos'];

export function isFinancialPath(pathname: string): boolean {
  return FINANCIAL_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Pure decision function so all three capability states are unit-testable
 * without rendering the shell.
 *
 * 'unknown' is deliberately excluded from the denial branch — see the test.
 */
export function financialGuardOutcome(
  pathname: string,
  canSeeFinancials: FinancialAccess,
): 'content' | 'loading' | 'denied' {
  if (!isFinancialPath(pathname)) return 'content';
  if (canSeeFinancials === true) return 'content';
  if (canSeeFinancials === 'unknown') return 'loading';
  return 'denied';
}
```

Inside the `AppLayout` component, read the capability and replace the bare
`<Outlet />` render with the guarded version:

```tsx
  const { canSeeFinancials } = useAuth();
  const outcome = financialGuardOutcome(location.pathname, canSeeFinancials);
```

then, at the `<Outlet />` site:

```tsx
  {outcome === 'content' && <Outlet />}
  {outcome === 'loading' && (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <Spinner size="lg" />
    </div>
  )}
  {outcome === 'denied' && <FinancialRestrictionScreen />}
```

Confirm the `Spinner` import path matches the repo (`grep -rn "from.*ui/spinner" apps/crm/src | head -1`).

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test -- financialRouteGuard
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
git add apps/crm/src/components/layout/AppLayout.tsx apps/crm/src/components/layout/FinancialRestrictionScreen.tsx apps/crm/src/components/layout/__tests__/financialRouteGuard.test.ts
git commit -m "feat(crm): add financial route guard that preserves the app shell"
```

---

### Task 7: Move reads to views, shape write payloads

**Files:**
- Modify: `apps/crm/src/store/team.ts:16-42`
- Modify: `apps/crm/src/store/clients.ts:50-100`
- Modify: `apps/crm/src/services/analytics.ts:236-239`
- Modify: `apps/crm/src/store/workflows.ts:456`
- Create: `apps/crm/src/store/__tests__/financialPayload.test.ts`

**Interfaces:**
- Consumes: `membros_v` / `clientes_v` from Task 2
- Produces: `stripFinancialFields<T>(payload: T, canSeeFinancials: FinancialAccess, keys: string[]): Partial<T>` exported from `@/lib/financialAccess`.

**Why write-returns need explicit column lists:** `INSERT/UPDATE … RETURNING` requires `SELECT` on every returned column. `.select()` with no argument is `RETURNING *`, so after Migration B a restricted admin's otherwise-valid insert would fail and roll back — client creation would break entirely rather than degrade. No caller consumes these return values today (verified), so narrowing the projection has no type ripple.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/store/__tests__/financialPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripFinancialFields } from '../../lib/financialAccess';

describe('stripFinancialFields', () => {
  it('omits the key entirely when access is denied', () => {
    const out = stripFinancialFields(
      { nome: 'A', valor_mensal: 0, telefone: '9' },
      false,
      ['valor_mensal'],
    );
    expect('valor_mensal' in out).toBe(false);
    expect(out).toEqual({ nome: 'A', telefone: '9' });
  });

  // Omission, not zeroing: the forms send `valor: '' ? Number : 0`, so a literal
  // 0 reaches the payload for a blank field. Passing that through would make the
  // write guard reject EVERY client edit a restricted admin attempts — including
  // changing a phone number — and if the guard were ever loosened it would
  // silently zero the retainer.
  it('omits rather than zeroes', () => {
    const out = stripFinancialFields({ valor_mensal: 5000 }, false, ['valor_mensal']);
    expect(out).not.toHaveProperty('valor_mensal');
  });

  it('omits while access is unknown', () => {
    const out = stripFinancialFields({ valor_mensal: 1 }, 'unknown', ['valor_mensal']);
    expect('valor_mensal' in out).toBe(false);
  });

  it('passes the payload through untouched when authorized', () => {
    const input = { nome: 'A', valor_mensal: 5000 };
    expect(stripFinancialFields(input, true, ['valor_mensal'])).toEqual(input);
  });

  it('handles several keys at once', () => {
    const out = stripFinancialFields(
      { nome: 'X', custo_mensal: 1, valor_mensal: 2 },
      false,
      ['custo_mensal', 'valor_mensal'],
    );
    expect(out).toEqual({ nome: 'X' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- financialPayload
```

Expected: FAIL — `stripFinancialFields is not exported`.

- [ ] **Step 3: Add `stripFinancialFields`**

Append to `apps/crm/src/lib/financialAccess.ts`:

```ts
/**
 * Remove financial keys from a write payload when the caller lacks access.
 *
 * OMITS the key rather than nulling or zeroing it, so the database write guard
 * sees no financial column in the statement at all and lets ordinary edits
 * through. Hiding the input alone is insufficient — the forms send a literal `0`
 * for a blank field.
 */
export function stripFinancialFields<T extends Record<string, unknown>>(
  payload: T,
  access: FinancialAccess,
  keys: string[],
): Partial<T> {
  if (access === true) return payload;
  const out = { ...payload };
  for (const k of keys) delete out[k];
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- financialPayload
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Point reads at the views and narrow write-returns**

In `apps/crm/src/store/team.ts`:

```ts
/** Allowlisted columns — must match the GRANT in Migration B exactly. */
const MEMBRO_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento, created_at, crm_user_id';

export async function getMembros(): Promise<Membro[]> {
  // Reads go through the masking view; writes stay on the base table.
  const { data, error } = await supabase
    .from('membros_v')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addMembro(m: Omit<Membro, 'id' | 'user_id' | 'conta_id'>): Promise<void> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  // RETURNING is narrowed to the allowlist: `.select()` is RETURNING *, which
  // needs SELECT on custo_mensal and would fail for a restricted admin.
  const { error } = await supabase
    .from('membros')
    .insert({ ...m, user_id, conta_id })
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
}

export async function updateMembro(
  id: number,
  m: Partial<Omit<Membro, 'id' | 'user_id' | 'conta_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('membros')
    .update(m)
    .eq('id', id)
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
}
```

In `apps/crm/src/store/clients.ts`, apply the same shape:

```ts
/** Allowlisted columns — must match the GRANT in Migration B exactly. */
const CLIENTE_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status, ' +
  'created_at, notion_page_url, data_pagamento, especialidade, data_aniversario, ' +
  'dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis';
```

- `getClientes()` reads `.from('clientes_v').select('*')`.
- `addCliente` keeps returning `Cliente` (its auto-seed branch uses `data.id`), but changes `.select()` to `.select(CLIENTE_SAFE_COLUMNS)`.
- `updateCliente` returns `void` and uses `.select(CLIENTE_SAFE_COLUMNS)`.

In `apps/crm/src/services/analytics.ts:239`, change the client lookup from
`.select('*')` to the columns `getPortfolioSummary` actually uses. **Do not**
capability-gate this function: its contract is Instagram accounts, top/worst
posts and growth counters — no monetary field. It is also excluded from the
revocation cache purge.

In `apps/crm/src/store/workflows.ts:456`, point the `clientes` read at
`clientes_v`.

- [ ] **Step 6: Verify no `select('*')` remains against the base tables**

```bash
grep -rn "from('clientes')\|from('membros')" apps/crm/src --include='*.ts' --include='*.tsx' | grep -v __tests__
```

Expected: only write paths (`insert`, `update`, `delete`) appear. Any remaining
`.select('*')` on a base table is a bug that surfaces only after Migration B.

- [ ] **Step 7: Verify the suite and typecheck**

```bash
npm run test && npm run build
```

Expected: all pass. Fix any caller that consumed a now-`void` return.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/store apps/crm/src/services/analytics.ts apps/crm/src/lib/financialAccess.ts
git commit -m "feat(crm): read financial tables through masking views, narrow write returns"
```

---

### Task 8: Derived values and page-level capability gates

**Files:**
- Modify: `apps/crm/src/store/computed.ts:9-95`
- Create: `apps/crm/src/store/__tests__/computed.financial.test.ts`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:1793` (finance section + edit field)
- Modify: `apps/crm/src/pages/cliente-detalhe/clienteDetalheNav.model.ts`
- Modify: `apps/crm/src/pages/membro-detalhe/MembroDetalhePage.tsx:119,140,176,222`
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx:131,143-144,174`
- Modify: `apps/crm/src/pages/calendario/CalendarioPage.tsx:870-989`
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx:169,214,227`
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx`
- Modify: `apps/crm/src/components/layout/GlobalSearchTrigger.tsx:50-56`
- Modify: `apps/crm/src/pages/leads/LeadsPage.tsx:329`

**Interfaces:**
- Consumes: `formatFinancialBRL`, `stripFinancialFields`, `canSeeFinancials`
- Produces: `projetarAgendamentos(transacoesFisicas, clientes, membros, canSeeFinancials: FinancialAccess)`; `getDashboardStats(canSeeFinancials: FinancialAccess)` returning `receitaMensal: number | null`, `despesaTotal: number | null`, `saldo: number | null`; `BuildNavModelInput` gains `canSeeFinancials: boolean`

- [ ] **Step 1: Write the failing test for derived values**

Create `apps/crm/src/store/__tests__/computed.financial.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projetarAgendamentos } from '../computed';
import type { Cliente } from '../clients';
import type { Membro } from '../team';
import type { Transacao } from '../finance';

// After Migration B a restricted admin reads valor_mensal/custo_mensal as NULL
// through the views. Number(null) is 0, so anything that infers from the value
// instead of branching on the capability renders phantom "R$ 0" entries that
// look like real scheduled money.
const maskedCliente = {
  id: 1,
  nome: 'Cliente A',
  status: 'ativo',
  data_pagamento: 10,
  valor_mensal: null,
} as unknown as Cliente;

const maskedMembro = {
  id: 1,
  nome: 'Fulano',
  data_pagamento: 5,
  custo_mensal: null,
} as unknown as Membro;

describe('projetarAgendamentos', () => {
  it('projects real amounts when authorized', () => {
    const out = projetarAgendamentos(
      [],
      [{ ...maskedCliente, valor_mensal: 3000 } as Cliente],
      [],
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].valor).toBe(3000);
  });

  it('projects NOTHING when the capability is absent', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], false);
    expect(out).toHaveLength(0);
  });

  it('projects nothing while the capability is unknown', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], 'unknown');
    expect(out).toHaveLength(0);
  });

  it('never emits a zero-valued projection from a masked value', () => {
    const out = projetarAgendamentos([], [maskedCliente], [maskedMembro], false);
    expect(out.some((t) => t.valor === 0)).toBe(false);
  });

  it('preserves physical transactions regardless of capability', () => {
    const fisica = { id: 9, tipo: 'saida', valor: 50, data: '2026-07-10' } as Transacao;
    const out = projetarAgendamentos([fisica], [maskedCliente], [], false);
    expect(out).toEqual([fisica]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- computed.financial
```

Expected: FAIL — `projetarAgendamentos` takes 3 arguments and emits `R$ 0` rows.

- [ ] **Step 3: Branch on the capability, never on the value**

In `apps/crm/src/store/computed.ts`, add the parameter and the guards:

```ts
import type { FinancialAccess } from '@/lib/financialAccess';

export function projetarAgendamentos(
  transacoesFisicas: Transacao[],
  clientes: Cliente[],
  membros: Membro[],
  canSeeFinancials: FinancialAccess,
): Transacao[] {
  const transacoes = [...transacoesFisicas];

  // Branch on the explicit capability, NEVER on the value. A legitimately null
  // retainer is indistinguishable from a masked one, and Number(null) is 0 —
  // inference would render phantom "R$ 0" scheduled entries.
  if (canSeeFinancials !== true) return transacoes;

  // ...existing projection logic unchanged...
}
```

And in `getDashboardStats`:

```ts
export async function getDashboardStats(canSeeFinancials: FinancialAccess) {
  const [clientes, transacoesFisicas, membros] = await Promise.all([
    getClientes(),
    getTransacoes(),
    getMembros(),
  ]);

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const transacoes = projetarAgendamentos(
    transacoesFisicas,
    clientes,
    membros,
    canSeeFinancials,
  );
  const transacoesMes = transacoes.filter((t) => t.data.startsWith(mesAtual));
  const clientesAtivos = clientes.filter((c) => c.status === 'ativo');

  // null, not 0: the dashboard must render a mask, not a believable R$ 0.
  const authorized = canSeeFinancials === true;
  const receitaMensal = authorized
    ? clientesAtivos.reduce((sum, c) => sum + Number(c.valor_mensal), 0)
    : null;
  const despesaTotal = authorized
    ? transacoesMes.filter((t) => t.tipo === 'saida').reduce((s, t) => s + Number(t.valor), 0)
    : null;

  return {
    clientes,
    clientesAtivos,
    receitaMensal,
    despesaTotal,
    saldo: authorized ? (receitaMensal as number) - (despesaTotal as number) : null,
    transacoes: transacoesMes,
  };
}
```

Update every `getDashboardStats()` and `projetarAgendamentos()` call site to pass
the capability, and every consumer of `receitaMensal`/`despesaTotal`/`saldo` to
render through `formatFinancialBRL(value, canSeeFinancials)`, which already
handles `null`:

```bash
grep -rn "getDashboardStats\|projetarAgendamentos" apps/crm/src --include='*.ts' --include='*.tsx' | grep -v __tests__
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test -- computed.financial
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the nav model**

Add to the existing `clienteDetalheNav.model` test file (find it with
`ls apps/crm/src/pages/cliente-detalhe/__tests__/`):

```ts
  it('hides the financeiro section from a restricted admin but keeps relatorio and hub', () => {
    const model = buildNavModel({ ...baseInput, isAgent: false, canSeeFinancials: false });
    const keys = model.sections.map((s) => s.key);
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('relatorio');
    expect(keys).toContain('hub');
  });

  it('shows financeiro to an authorized admin', () => {
    const model = buildNavModel({ ...baseInput, isAgent: false, canSeeFinancials: true });
    expect(model.sections.map((s) => s.key)).toContain('financeiro');
  });
```

Add `canSeeFinancials: true` to whatever `baseInput` fixture the file already defines.

- [ ] **Step 6: Run to verify it fails**

```bash
npm run test -- clienteDetalheNav
```

Expected: FAIL — `financeiro` still present for a restricted admin.

- [ ] **Step 7: Split the nav model inputs**

In `clienteDetalheNav.model.ts`, add to `BuildNavModelInput`:

```ts
  /**
   * Separate from `isAgent` on purpose: Relatório and Hub stay role-based while
   * Financeiro becomes capability-based. A restricted ADMIN keeps the first two.
   */
  canSeeFinancials: boolean;
```

In the builder, gate the `financeiro` section on `input.canSeeFinancials` instead of `!input.isAgent`, leaving `relatorio` and `hub` on `isAgent`.

- [ ] **Step 8: Run to verify it passes**

```bash
npm run test -- clienteDetalheNav
```

Expected: PASS.

- [ ] **Step 9: Gate each page**

Read `canSeeFinancials` from `useAuth()` in each file and apply:

- **`ClienteDetalhePage.tsx:1793`** — the finance section render gate and its edit field are `!isAgent` today; the nav model alone does not hide them. Change both to `canSeeFinancials === true`. Pass `canSeeFinancials` into `buildNavModel`. Wrap the `:773` `updateCliente` payload in `stripFinancialFields(payload, canSeeFinancials, ['valor_mensal'])`.
- **`MembroDetalhePage.tsx`** — replace `formatBRL(membro.custo_mensal ?? 0)` at `:176` and `:222` with `formatFinancialBRL(membro.custo_mensal, canSeeFinancials)`. Gate the edit action at `:140` and the salary form field. Wrap the `:115` payload in `stripFinancialFields(payload, canSeeFinancials, ['custo_mensal'])`.
- **`EquipePage.tsx`** — hide the cost KPI (`:131`) and the cost column; hide the `custo_maior` / `custo_menor` sort options (`:143-144`); wrap the `:174` payload in `stripFinancialFields`.
- **`CalendarioPage.tsx:870-989`** — the income/expense projection, the day cells and the payment-confirmation action live in the page, **not** in `computed.ts`. Each needs its own gate. Branch on the explicit capability, never on a nullable financial value: a legitimately null retainer is indistinguishable from a masked one, and `Number(null)` is `0`, so inference renders phantom `R$ 0` entries.
- **`ClientesPage.tsx`** — hide the `valor_mensal` sort option (`:169`, `:393`); wrap the `:214` and `:227` payloads in `stripFinancialFields`.
- **`LeadsPage.tsx:329`** — wrap the `addCliente` payload the same way.
- **`DashboardPage.tsx`** — gate the KPI strip and the recebimento/despesa events.
- **`GlobalSearchTrigger.tsx:50-56`** — disable the `contratos` and `transacoes` queries and their result groups when `canSeeFinancials !== true`. This component has no role gating at all today.

- [ ] **Step 10: Replace remaining `formatBRL` call sites**

```bash
grep -rn "formatBRL" apps/crm/src --include='*.tsx' --include='*.ts' | grep -v __tests__
```

Replace every production call site with `formatFinancialBRL(value, canSeeFinancials)`. When the file has no `useAuth()` access (a pure helper), thread the capability in as a parameter rather than importing the context.

- [ ] **Step 11: Verify and commit**

```bash
npm run test && npm run build && npm run lint
git add -u apps/crm/src
git commit -m "feat(crm): gate financial values and controls on the capability"
```

---

### Task 9: Membros route and actions read `workspaceRole`

**Files:**
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoLayout.tsx:31`
- Modify: `apps/crm/src/pages/configuracao/configTabs.ts`
- Modify: `apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx:52`

**Interfaces:**
- Consumes: `workspaceRole` from Task 4
- Produces: nothing new

**Why:** the toggle lives in Membros, and the route to it is gated by `profiles.role` today. A genuine owner whose stale `profiles.role` reads `agent` cannot reach the toggle at all, so gating only the control is insufficient. The route, the query and the member-management actions all move.

- [ ] **Step 1: Move the tab strip and route guard**

In `ConfiguracaoLayout.tsx`, replace `role` with `workspaceRole` in the
`visibleConfigTabs` and `canAccessConfigTab` calls (`:31`, `:34`). Extend the
existing loading gate so it also waits for the membership:

```tsx
  const { user, loading, workspaceRole } = useAuth();

  // Wait for the role before deciding anything: rendering the strip early would
  // flash the agent-sized set of tabs at an owner, and the guard below would
  // bounce them off a tab they are allowed to see.
  if (loading || !user || workspaceRole === null) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }
```

- [ ] **Step 2: Move the member query and actions**

In `MembrosTab.tsx:52`:

```tsx
  const { user, profile, workspaceRole } = useAuth();
  const isOwnerOrAdmin = workspaceRole === 'owner' || workspaceRole === 'admin';
  const isOwner = workspaceRole === 'owner';
```

Use `isOwner` for owner-only member-management actions in this file.

- [ ] **Step 3: Verify and commit**

```bash
npm run test && npm run build
git add -u apps/crm/src/pages/configuracao
git commit -m "refactor(crm): gate Membros route, query and actions on workspaceRole"
```

---

### Task 10: CSV imports reject protected columns before writing

**Files:**
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx:258-280`
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx:212-235`
- Create: `apps/crm/src/lib/__tests__/csvFinancialGuard.test.ts`

**Interfaces:**
- Consumes: `FinancialAccess`
- Produces: `assertNoFinancialColumns(rows: Record<string, unknown>[], access: FinancialAccess, keys: string[]): void` from `@/lib/financialAccess` — throws `Error` with a pt-BR message naming the offending column.

**Why the check must run before the first insert:** both importers loop `addCliente`/`addMembro` one row at a time with no transaction around the loop. A check that fired on the offending *row* would leave every preceding row committed — exactly the partial import this rule exists to prevent.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/csvFinancialGuard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertNoFinancialColumns } from '../financialAccess';

describe('assertNoFinancialColumns', () => {
  it('throws naming the offending column when a restricted user supplies it', () => {
    expect(() =>
      assertNoFinancialColumns(
        [{ nome: 'A', valor_mensal: '100' }],
        false,
        ['valor_mensal'],
      ),
    ).toThrow(/valor_mensal/);
  });

  it('detects the column even when only a later row carries it', () => {
    expect(() =>
      assertNoFinancialColumns(
        [{ nome: 'A' }, { nome: 'B', valor_mensal: '5' }],
        false,
        ['valor_mensal'],
      ),
    ).toThrow(/valor_mensal/);
  });

  it('throws while access is unknown', () => {
    expect(() =>
      assertNoFinancialColumns([{ valor_mensal: '1' }], 'unknown', ['valor_mensal']),
    ).toThrow();
  });

  it('allows the column when authorized', () => {
    expect(() =>
      assertNoFinancialColumns([{ valor_mensal: '1' }], true, ['valor_mensal']),
    ).not.toThrow();
  });

  it('allows a file without the column at all', () => {
    expect(() =>
      assertNoFinancialColumns([{ nome: 'A' }], false, ['valor_mensal']),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- csvFinancialGuard
```

Expected: FAIL — `assertNoFinancialColumns is not exported`.

- [ ] **Step 3: Implement the guard**

Append to `apps/crm/src/lib/financialAccess.ts`:

```ts
/**
 * Reject a CSV import that carries a protected column the caller cannot write.
 *
 * MUST be called on the parsed rows BEFORE the first insert. Both importers loop
 * row-by-row with no enclosing transaction, so a per-row check would commit
 * every preceding row before failing.
 *
 * Rejects the whole file rather than silently stripping: stripping reports
 * success while discarding exactly the data the user believed they imported.
 */
export function assertNoFinancialColumns(
  rows: Record<string, unknown>[],
  access: FinancialAccess,
  keys: string[],
): void {
  if (access === true) return;
  const present = keys.filter((k) => rows.some((r) => k in r));
  if (present.length > 0) {
    throw new Error(
      `Importação cancelada: seu acesso não permite enviar a coluna "${present.join('", "')}". ` +
        `Remova-a do arquivo e tente novamente. Nenhum registro foi importado.`,
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test -- csvFinancialGuard
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire both importers**

In `ClientesPage.tsx`, as the very first statement inside the `openCSVSelector` callback (before `let count = 0`):

```ts
        try {
          assertNoFinancialColumns(rows, canSeeFinancials, ['valor_mensal']);
        } catch (e) {
          toast.error((e as Error).message);
          return;
        }
```

Do the same in `EquipePage.tsx` with `['custo_mensal']`. Also wrap the per-row
payloads (`ClientesPage.tsx:271`, `EquipePage.tsx:228`) in `stripFinancialFields`
so an authorized-then-revoked race cannot slip a value through.

- [ ] **Step 6: Verify and commit**

```bash
npm run test && npm run build
git add -u apps/crm/src
git commit -m "feat(crm): reject CSV imports carrying protected financial columns"
```

---

### Task 11: Live revocation

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx`
- Create: `apps/crm/src/context/__tests__/revocation.test.ts`

**Interfaces:**
- Consumes: `getMyMembership` from Task 4, the realtime publication from Task 1
- Produces: `FINANCIAL_QUERY_KEYS: string[]` exported from `AuthContext.tsx`

**Severity, stated precisely:** this is a correctness and UX concern, not a disclosure boundary. The database denies the read regardless of what the client believes, so a stale cache cannot survive a refetch and no new financial data can be obtained. This is defence-in-depth over values already in memory — it must not be described, or relied upon, as the enforcement boundary.

**`REPLICA IDENTITY` limits what the subscription can see.** Migration A adds `workspace_members` to the publication under the *default* replica identity, so DELETE events carry only the primary key. A subscription filtered on `user_id=eq.<uid>` matches no DELETE payload, and therefore **silently misses revocation-by-deletion** — removing someone from the workspace entirely — while looking perfectly healthy. Two consequences, both binding:

- Subscribe to `UPDATE` for the flag flip, which carries the full new row. Do not rely on the subscription for deletions.
- **The bounded poll is what actually covers deletion.** That is a second, independent reason it is mandatory rather than a nicety, alongside the focus-event gap.

Making DELETE usable would need `ALTER TABLE public.workspace_members REPLICA IDENTITY FULL`, which costs write amplification on every update to that table. That is a deliberate trade, not something to add in passing — leave it.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/context/__tests__/revocation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FINANCIAL_QUERY_KEYS } from '../AuthContext';

describe('FINANCIAL_QUERY_KEYS', () => {
  it('covers every cache holding financial values', () => {
    expect(FINANCIAL_QUERY_KEYS).toEqual(
      expect.arrayContaining(['clientes', 'membros', 'transacoes', 'contratos', 'dashboardStats']),
    );
  });

  // portfolioSummary is Instagram accounts, top/worst posts and growth counters
  // (analytics.ts:236) — no monetary field. Purging it would refetch a large
  // payload for no reason.
  it('excludes portfolioSummary, which holds no financial data', () => {
    expect(FINANCIAL_QUERY_KEYS).not.toContain('portfolioSummary');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- revocation
```

Expected: FAIL — `FINANCIAL_QUERY_KEYS is not exported`.

- [ ] **Step 3: Implement the subscription**

In `AuthContext.tsx`, add the export:

```ts
/** Caches holding financial values, purged on revocation. */
export const FINANCIAL_QUERY_KEYS = [
  'clientes',
  'membros',
  'transacoes',
  'contratos',
  'dashboardStats',
];
```

Add an effect keyed on `[userId, profile?.conta_id]`:

```ts
  useEffect(() => {
    const workspaceId = profile?.conta_id;
    if (!userId || !workspaceId) return;

    const applyMembership = (next: { role?: string; can_see_financials?: boolean } | null) => {
      if (!next) return;
      const wasAllowed = canSeeFinancialsRef.current === true;
      setWorkspaceRole((next.role as 'owner' | 'admin' | 'agent') ?? null);
      const nowAllowed =
        next.role === 'owner' ? true : next.role === 'admin' ? !!next.can_see_financials : false;
      setCanSeeFinancials(nowAllowed);

      if (wasAllowed && !nowAllowed) {
        for (const key of FINANCIAL_QUERY_KEYS) {
          queryClient.removeQueries({ queryKey: [key] });
        }
        void queryClient.refetchQueries({ type: 'active' });
      }
    };

    const channel = supabase
      .channel(`wm:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workspace_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => applyMembership(payload.new as { role?: string; can_see_financials?: boolean }),
      )
      .subscribe();

    // Bounded polling fallback. Refetch-on-focus alone is insufficient: focus
    // events never fire for a tab that stays foregrounded, which is precisely
    // the indefinite-cache case this exists to address.
    const poll = setInterval(() => {
      void getMyMembership().then(applyMembership).catch(() => {});
    }, 60_000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [userId, profile?.conta_id, queryClient]);
```

Add a ref mirroring the state so the handler reads the current value without
re-subscribing:

```ts
  const canSeeFinancialsRef = useRef<FinancialAccess>('unknown');
  useEffect(() => {
    canSeeFinancialsRef.current = canSeeFinancials;
  }, [canSeeFinancials]);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test -- revocation
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Close dialogs and navigate away**

The revocation path must also close or reset any dialog holding financial values
in component state, and navigate away from a financial route. The route guard in
Task 6 already handles the second automatically once `canSeeFinancials` flips to
`false`. For the first, audit dialogs in `EquipePage`, `ClientesPage`,
`MembroDetalhePage` and `ClienteDetalhePage` and add
`useEffect(() => { if (canSeeFinancials !== true) setDialogOpen(false); }, [canSeeFinancials])`.

- [ ] **Step 6: Verify and commit**

```bash
npm run test && npm run build
git add -u apps/crm/src/context
git commit -m "feat(crm): purge financial caches on live revocation"
```

---

### Task 12: Migration B — enforcement

**Files:**
- Create: `supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql`
- Create: `supabase/tests/entitlements/52_financial_enforcement.sql`

**Interfaces:**
- Consumes: `can_see_financials()` from Task 1
- Produces: column-level grants on `membros`/`clientes`; eight rewritten policies on `transacoes`/`contratos`; `public.guard_financial_write()` trigger function.

**This is the breaking step.** It is also not behaviorally inert: default `true` preserves existing *admins*, but it newly blocks *agents* from financial DML and from the direct salary/retainer access they hold today. That is an intentional security fix and must be announced as one.

- [ ] **Step 1: Regenerate and diff the allowlists**

The lists in Global Constraints were verified 2026-07-28. Any column added since
would vanish from the CRM. Regenerate before writing the migration:

```bash
npx supabase db reset >/dev/null 2>&1 && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "SELECT table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('clientes','membros') ORDER BY 1"
```

Expected: 20 `clientes` rows and 11 `membros` rows matching Global Constraints exactly. **If they differ, update the allowlists in this task, in Task 2's views, and in Task 7's `*_SAFE_COLUMNS` constants before continuing.**

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql`:

```sql
-- =============================================================
-- Per-admin financial visibility — Migration B (BREAKING)
--
-- Requires the step-2 client bundle to be deployed first: it revokes the
-- table-level SELECT that the previous bundle's select('*') calls depend on.
-- Blast radius is app-wide, not financial-only — getClientes()/getMembros()
-- feed dashboard, deliveries, analytics and search.
-- =============================================================

-- -------------------------------------------------------------
-- Column-level grants.
--
-- A table-level GRANT SELECT permits EVERY column, and a column-level revoke
-- does not carve out of it. The table grant must be revoked first, then an
-- explicit allowlist re-granted. The allowlist is also what keeps
-- UPDATE … RETURNING working on the write paths.
-- -------------------------------------------------------------
REVOKE SELECT ON public.membros  FROM authenticated;
REVOKE SELECT ON public.clientes FROM authenticated;

GRANT SELECT (
  id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento,
  created_at, crm_user_id
) ON public.membros TO authenticated;

GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis
) ON public.clientes TO authenticated;

-- -------------------------------------------------------------
-- Whole-row policies on transacoes / contratos.
--
-- The capability is CONJOINED with the tenant check, never substituted for it:
-- can_see_financials() does not authorize a target row's conta_id, so replacing
-- a USING expression with it alone would expose every workspace's rows.
--
-- Only SELECT carried an agent predicate (20260404); INSERT/UPDATE/DELETE
-- carried tenant checks only (20260315). Each is therefore rewritten in full —
-- SELECT-only RLS would leave INSERT open, letting a restricted admin post
-- entries they cannot read.
--
-- (SELECT public.can_see_financials()) is wrapped so it hoists to an InitPlan
-- instead of being evaluated per row.
-- -------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transacoes', 'contratos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      ) WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
      )$f$, t || '_delete', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Write guards.
--
-- auth.uid() IS NULL is NOT a proxy for service role — it also covers anonymous
-- requests. Only named trusted roles bypass.
--
-- NOTE: the current_user branch also exempts every SECURITY DEFINER function
-- owned by postgres, not just superuser sessions. Acceptable today (the only
-- such path writing these tables is set_membro_crm_user, which touches
-- crm_user_id alone). Any NEW SECURITY DEFINER path that can write a financial
-- column must call can_see_financials() itself.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_financial_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  col     text := TG_ARGV[0];
  old_val numeric;
  new_val numeric;
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', col) INTO new_val USING NEW;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1).%I', col) INTO old_val USING OLD;
  END IF;

  -- Only a CHANGE to the financial value is guarded. An INSERT carrying NULL,
  -- or an UPDATE that leaves the column alone, passes untouched — otherwise a
  -- restricted admin could not change a phone number.
  IF (TG_OP = 'INSERT' AND new_val IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND new_val IS DISTINCT FROM old_val) THEN
    IF public.can_see_financials() IS NOT TRUE THEN
      RAISE EXCEPTION 'financial_access_denied'
        USING HINT = format('column %s requires financial access', col);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_membros_custo   ON public.membros;
DROP TRIGGER IF EXISTS trg_guard_clientes_valor  ON public.clientes;

CREATE TRIGGER trg_guard_membros_custo
  BEFORE INSERT OR UPDATE ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_write('custo_mensal');

CREATE TRIGGER trg_guard_clientes_valor
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_write('valor_mensal');

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- authenticated must NOT hold table-wide SELECT on either table
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN ('membros','clientes')
      AND grantee='authenticated' AND privilege_type='SELECT'
  ) THEN
    RAISE EXCEPTION 'table-level SELECT survives on membros/clientes for authenticated';
  END IF;

  -- ...but must hold column SELECT on a representative allowlisted column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='clientes'
      AND grantee='authenticated' AND privilege_type='SELECT' AND column_name='nome'
  ) THEN
    RAISE EXCEPTION 'authenticated lost SELECT on clientes.nome';
  END IF;

  -- ...and must NOT hold it on the protected columns
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema='public' AND grantee='authenticated' AND privilege_type='SELECT'
      AND ((table_name='clientes' AND column_name='valor_mensal')
        OR (table_name='membros'  AND column_name='custo_mensal'))
  ) THEN
    RAISE EXCEPTION 'authenticated retains SELECT on a protected financial column';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('transacoes','contratos');
  IF n <> 8 THEN
    RAISE EXCEPTION 'expected 8 policies on transacoes/contratos, found %', n;
  END IF;

  -- Every one must still carry the tenant conjunct. A policy that lost it would
  -- turn a capability check into a tenant-wide exposure.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('transacoes','contratos')
      AND coalesce(qual, with_check) NOT LIKE '%get_my_conta_id%'
  ) THEN
    RAISE EXCEPTION 'a policy lost its get_my_conta_id tenant conjunct';
  END IF;
END $$;
```

- [ ] **Step 3: Write the failing test**

Create `supabase/tests/entitlements/52_financial_enforcement.sql`. Cover, using
the `set local role authenticated` pattern from Task 1:

- restricted admin blocked on all four verbs of `transacoes` and `contratos`;
- authorized admin and owner **not** over-blocked — positive CRUD on both tables;
- cross-tenant regression on all eight policies: a user with financial access in
  workspace A cannot read or write workspace B's rows;
- agent-hardening acceptance: an agent cannot select `custo_mensal` or
  `valor_mensal`, and cannot INSERT/UPDATE/DELETE `transacoes`/`contratos` —
  all of which they can do today;
- `authenticated` cannot select the protected columns from the base tables, and
  *can* still select every allowlisted column;
- write guards: restricted INSERT with NULL succeeds; restricted INSERT with a
  value fails; restricted UPDATE of a non-financial field succeeds; authorized
  admin/owner can change the value; anonymous does not get the trusted bypass;
- **allowlist dependants still work**: an `authenticated` caller can still
  `SELECT` from `instagram_accounts` and `hub_brand` (whose policies sub-select
  `clientes`) and still execute `get_client_health_aggregates(28)`. These fail on
  the *dependent* object, not on `clientes`, so nothing else in the suite would
  catch a regression.

For every denied UPDATE/DELETE assert **both** the affected-row count and the
unchanged underlying data — RLS yields zero affected rows rather than raising:

```sql
  set local role authenticated;
  update transacoes set valor = 1 where id = v_tx;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'restricted admin updated % transacoes rows', v_rows;
  end if;
  select valor into v_val from transacoes where id = v_tx;
  if v_val = 1 then
    raise exception 'restricted admin mutated the row despite 0 reported rows';
  end if;
```

The unknown-role branch cannot be integration-tested: the
`CHECK (role IN ('owner','admin','agent'))` constraint rejects unknown roles
before the predicate sees them. Treat it as a source-level contract and say so in
a comment rather than implying coverage.

- [ ] **Step 4: Run to verify it fails, then apply**

```bash
./scripts/test-entitlements.sh   # expect FAIL on 52_
npx supabase db reset && ./scripts/test-entitlements.sh
```

Expected: all suites PASS, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql supabase/tests/entitlements/52_financial_enforcement.sql
git commit -m "feat(db): enforce per-admin financial visibility (Migration B)"
```

---

### Task 13: The setter — RPC and edge-function action

**Files:**
- Create: `supabase/migrations/20260728000003_set_financial_access_rpc.sql`
- Create: `supabase/functions/manage-workspace-user/setFinancialAccess.ts`
- Modify: `supabase/functions/manage-workspace-user/index.ts`
- Create: `supabase/functions/__tests__/set_financial_access_test.ts`
- Modify: `apps/crm/src/store/workspace.ts`

**Interfaces:**
- Consumes: the column from Task 1
- Produces: RPC `public.set_financial_access(p_actor uuid, p_target uuid, p_workspace uuid, p_value boolean) RETURNS text` returning `'updated'` or `'noop'`; store fn `setWorkspaceUserFinancialAccess(userId: string, value: boolean): Promise<void>`.

- [ ] **Step 1: Write the RPC**

Create `supabase/migrations/20260728000003_set_financial_access_rpc.sql`:

```sql
-- Atomic owner-check + update + audit for the financial-access toggle.
--
-- One transaction on purpose: the sibling actions in manage-workspace-user are
-- non-transactional multi-writes (update-role writes workspace_members then
-- profiles then the audit log with no rollback path), and cancel-invite writes
-- no audit row at all. The new action must not copy that pattern.
CREATE OR REPLACE FUNCTION public.set_financial_access(
  p_actor     uuid,
  p_target    uuid,
  p_workspace uuid,
  p_value     boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role  text;
  v_target_role text;
  v_current     boolean;
BEGIN
  SELECT role INTO v_actor_role FROM public.workspace_members
   WHERE user_id = p_actor AND workspace_id = p_workspace;

  -- Owner-only: two restricted admins must not be able to reinstate each other.
  IF v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  SELECT role, can_see_financials INTO v_target_role, v_current
    FROM public.workspace_members
   WHERE user_id = p_target AND workspace_id = p_workspace;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'target_not_member';
  END IF;
  IF v_target_role <> 'admin' THEN
    RAISE EXCEPTION 'target_not_admin';
  END IF;

  -- No-op writes NO audit row: auditing them would let anyone with the toggle
  -- pad the trail with entries that record no change.
  IF v_current IS NOT DISTINCT FROM p_value THEN
    RETURN 'noop';
  END IF;

  UPDATE public.workspace_members
     SET can_see_financials = p_value
   WHERE user_id = p_target AND workspace_id = p_workspace;

  INSERT INTO public.audit_logs
    (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_workspace, p_actor, 'set-financial-access', 'workspace_member',
          p_target::text,
          jsonb_build_object('old_value', v_current, 'new_value', p_value));

  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.set_financial_access(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_financial_access(uuid, uuid, uuid, boolean)
  TO service_role;
```

Verify the `audit_logs` column names against `supabase/functions/_shared/audit.ts` before running — adjust the INSERT if they differ.

- [ ] **Step 2: Write the failing edge-function test**

Create `supabase/functions/__tests__/set_financial_access_test.ts`. The existing
`manage-workspace-invite-contract_test.ts` is `Deno.readTextFile` plus regexes —
useful as a regression check on action names, but it cannot establish owner-only
behaviour. Test the extracted handler behaviourally with an injected client:

```ts
import { assertEquals } from "jsr:@std/assert";
import { handleSetFinancialAccess } from "../manage-workspace-user/setFinancialAccess.ts";

function fakeClient(rpcResult: { data?: unknown; error?: { message: string } }) {
  const calls: unknown[] = [];
  return {
    calls,
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

Deno.test("owner toggling an admin succeeds and reports the change", async () => {
  const client = fakeClient({ data: "updated" });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 200);
  assertEquals(client.calls.length, 1);
});

Deno.test("a caller whose MEMBERSHIP role is admin is rejected even if profiles says owner", async () => {
  const client = fakeClient({ error: { message: "not_owner" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "admin-2",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 403);
});

Deno.test("a non-admin target is rejected", async () => {
  const client = fakeClient({ error: { message: "target_not_admin" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "agent-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 400);
});

Deno.test("a foreign-workspace target is rejected", async () => {
  const client = fakeClient({ error: { message: "target_not_member" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "someone-else",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 404);
});

Deno.test("a no-op succeeds with 200 and reports no change", async () => {
  const client = fakeClient({ data: "noop" });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: true,
  });
  assertEquals(res.status, 200);
  assertEquals(res.changed, false);
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run test:functions -- --filter "financial"
git checkout -- deno.lock
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the handler**

Create `supabase/functions/manage-workspace-user/setFinancialAccess.ts`:

```ts
interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: { message: string } | null }>;
}

export interface SetFinancialAccessInput {
  actorUserId: string;
  targetUserId: string;
  workspaceId: string;
  value: boolean;
}

export interface SetFinancialAccessResult {
  status: number;
  message: string;
  changed: boolean;
}

/**
 * Dependency-injected so it can be tested behaviourally. All authorization
 * lives in the RPC, which resolves the caller from workspace_members — NOT from
 * profiles, whose role goes stale on workspace switch.
 *
 * Never returns raw error details to the client; the RPC's sentinel messages are
 * mapped to generic pt-BR copy.
 */
export async function handleSetFinancialAccess(
  client: RpcClient,
  input: SetFinancialAccessInput,
): Promise<SetFinancialAccessResult> {
  const { data, error } = await client.rpc("set_financial_access", {
    p_actor: input.actorUserId,
    p_target: input.targetUserId,
    p_workspace: input.workspaceId,
    p_value: input.value,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("not_owner")) {
      return { status: 403, message: "Apenas o proprietário pode alterar esse acesso.", changed: false };
    }
    if (m.includes("target_not_admin")) {
      return { status: 400, message: "Esse acesso só se aplica a administradores.", changed: false };
    }
    if (m.includes("target_not_member")) {
      return { status: 404, message: "Membro não encontrado neste workspace.", changed: false };
    }
    console.error("[set-financial-access] rpc failed:", m);
    return { status: 500, message: "Não foi possível atualizar o acesso.", changed: false };
  }

  const changed = data === "updated";
  return {
    status: 200,
    message: changed ? "Acesso financeiro atualizado." : "Nenhuma alteração.",
    changed,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm run test:functions -- --filter "financial"
git checkout -- deno.lock
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Wire the action into `index.ts`**

Add to `supabase/functions/manage-workspace-user/index.ts`, placed **after** the
`accept-invite` block but **before** the `profiles`-based caller resolution — the
new action must not inherit that stale-role check:

```ts
    if (action === "set-financial-access") {
      const { value } = body;
      if (typeof value !== "boolean") {
        return new Response(JSON.stringify({ error: "value must be a boolean" }), { status: 400, headers });
      }
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: "targetUserId is required" }), { status: 400, headers });
      }

      // Resolve the workspace from the caller's own membership, not profiles.
      const { data: prof } = await serviceClient
        .from("profiles").select("active_workspace_id").eq("id", user.id).single();
      const workspaceId = prof?.active_workspace_id;
      if (!workspaceId) {
        return new Response(JSON.stringify({ error: "Workspace não encontrado." }), { status: 403, headers });
      }

      const result = await handleSetFinancialAccess(serviceClient, {
        actorUserId: user.id,
        targetUserId,
        workspaceId,
        value,
      });
      return new Response(
        JSON.stringify(result.status === 200 ? { message: result.message, changed: result.changed } : { error: result.message }),
        { status: result.status, headers },
      );
    }
```

Add the import at the top:

```ts
import { handleSetFinancialAccess } from "./setFinancialAccess.ts";
```

- [ ] **Step 7: Add the store binding**

Append to `apps/crm/src/store/workspace.ts`:

```ts
export async function setWorkspaceUserFinancialAccess(
  userId: string,
  value: boolean,
): Promise<void> {
  await callManageWorkspaceUser('set-financial-access', userId, { value });
}
```

- [ ] **Step 8: Verify and commit**

```bash
npx supabase db reset && ./scripts/test-entitlements.sh
npm run test:functions -- --filter "financial" && git checkout -- deno.lock
npm run build
git add supabase/migrations/20260728000003_set_financial_access_rpc.sql supabase/functions/manage-workspace-user apps/crm/src/store/workspace.ts supabase/functions/__tests__/set_financial_access_test.ts
git commit -m "feat(api): add owner-only set-financial-access action"
```

---

### Task 14: The toggle UI

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx`
- Modify: `apps/crm/src/store/workspace.ts:3-19` (`getWorkspaceUsers`)

**Interfaces:**
- Consumes: `setWorkspaceUserFinancialAccess` from Task 13, `workspaceRole` from Task 4
- Produces: nothing

- [ ] **Step 1: Return the flag from `getWorkspaceUsers`**

In `apps/crm/src/store/workspace.ts:7`, add the column to the select and the
flattened shape:

```ts
    .select('user_id, role, joined_at, can_see_financials, profiles!inner(id, nome, avatar_url, created_at)')
```

```ts
  return (data || []).map((m: any) => ({
    id: m.profiles.id,
    nome: m.profiles.nome,
    role: m.role,
    can_see_financials: m.can_see_financials,
    avatar_url: m.profiles.avatar_url,
    created_at: m.profiles.created_at,
  }));
```

- [ ] **Step 2: Add the control**

In `MembrosTab.tsx`, render a switch on each **admin** row, visible only when
`workspaceRole === 'owner'`. Owners and agents get no control — the flag is
meaningless for them and the setter rejects those targets.

```tsx
{isOwner && member.role === 'admin' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
    <Switch
      checked={member.can_see_financials}
      onCheckedChange={async (checked) => {
        try {
          await setWorkspaceUserFinancialAccess(member.id, checked);
          toast.success(
            checked ? 'Acesso financeiro liberado.' : 'Acesso financeiro restrito.',
          );
          await refetchWsUsers();
        } catch {
          toast.error('Não foi possível atualizar o acesso.');
        }
      }}
    />
    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
      Ver financeiro
    </span>
  </div>
)}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server via the preview tooling (never `npm run dev` in a shell),
sign in as an owner, open `/configuracao/membros`, and confirm: the switch shows
only on admin rows; toggling it off makes `/financeiro` and `/contratos`
disappear from the sidebar for that admin's session; and direct navigation to
`/financeiro` renders the restriction screen with sidebar and nav intact.

- [ ] **Step 4: Verify and commit**

```bash
npm run test && npm run build && npm run lint && npm run format:check
git add -u apps/crm/src
git commit -m "feat(crm): add per-admin financial access toggle to Membros"
```

---

### Task 15: Rollback scripts and the rollout runbook

**Files:**
- Create: `scripts/rollback-migration-b.sql`
- Create: `scripts/teardown-financial-visibility.sql`
- Modify: `CLAUDE.md` (Gotchas)

**Interfaces:**
- Consumes: everything above
- Produces: nothing

**Why two scripts:** rolling back Migration B happens while the step-2 bundle is still deployed, and that bundle reads `membros_v`/`clientes_v`. Dropping the views would break the very client the rollback is meant to stabilise. The views are harmless once table grants are restored — the `CASE` keeps evaluating and simply stops masking. View teardown is a separate script, paired with a frontend rollback.

- [ ] **Step 1: Write `scripts/rollback-migration-b.sql`**

```sql
-- Undo Migration B ONLY. Safe to run while the step-2 client bundle is live.
-- Does NOT drop the views — that bundle reads them.
--
-- Order matters: the triggers must go first. They survive a grant/policy
-- restore, so the old bundle's 0/null payloads would keep rejecting ordinary
-- client and member edits for restricted admins — a rollback that leaves the
-- app broken in a new way.

DROP TRIGGER IF EXISTS trg_guard_membros_custo  ON public.membros;
DROP TRIGGER IF EXISTS trg_guard_clientes_valor ON public.clientes;
DROP FUNCTION IF EXISTS public.guard_financial_write();

-- Restore the pre-B policies verbatim (20260315 tenant-only + 20260404 agent
-- predicate on SELECT).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transacoes', 'contratos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND public.get_my_role() IS DISTINCT FROM 'agent'
      )$f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT
      WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()))$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE
      USING (conta_id IN (SELECT public.get_my_conta_id()))
      WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()))$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE
      USING (conta_id IN (SELECT public.get_my_conta_id()))$f$, t || '_delete', t);
  END LOOP;
END $$;

GRANT SELECT ON public.membros  TO authenticated;
GRANT SELECT ON public.clientes TO authenticated;
```

**Before committing this file**, verify the restored SELECT predicate against the
real `20260404` migration — copy its `USING` expression verbatim rather than the
approximation above:

```bash
grep -rn -A6 "transacoes_select" supabase/migrations/20260404*.sql
```

- [ ] **Step 2: Write `scripts/teardown-financial-visibility.sql`**

```sql
-- FULL teardown. Run ONLY together with a frontend rollback to a pre-view
-- bundle — dropping the views breaks any client that reads them.
\i scripts/rollback-migration-b.sql

DROP VIEW IF EXISTS public.membros_v;
DROP VIEW IF EXISTS public.clientes_v;
DROP FUNCTION IF EXISTS public.set_financial_access(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.can_see_financials();
ALTER TABLE public.workspace_members DROP COLUMN IF EXISTS can_see_financials;
```

- [ ] **Step 3: Rehearse both on staging**

Staging is in sync with production as of 2026-07-28 (169 migrations, nothing
missing or orphaned). Apply Migration A, deploy the client, apply Migration B,
run `./scripts/test-entitlements.sh` against staging, then run
`rollback-migration-b.sql` and confirm the app still works. Re-apply B.

If `npx supabase db push` fails on staging, apply the checked-in SQL via the SQL
editor and then `supabase migration repair --status applied <version>` for each —
the SQL editor does not reconcile migration history, and skipping the repair
leaves permanent drift.

- [ ] **Step 4: Add the maintenance hazard to `CLAUDE.md`**

Under Gotchas:

```markdown
- `membros` and `clientes` use column-level `GRANT SELECT` allowlists (Migration
  `20260728000002`). Any column added to either table is invisible to the CRM
  until it is added to the grant, to `membros_v`/`clientes_v`, and to the
  `*_SAFE_COLUMNS` constants in `store/team.ts` / `store/clients.ts`. The failure
  surfaces as a confusing missing-column error. The same allowlist also keeps six
  PostgREST embeds, ten dependent RLS policies and `get_client_health_aggregates()`
  working — none of which a `from('clientes')` grep finds.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/rollback-migration-b.sql scripts/teardown-financial-visibility.sql CLAUDE.md
git commit -m "chore: add financial-visibility rollback scripts and gotcha"
```

---

## Rollout order

The tasks build in deploy order. Do not reorder — Migration B is breaking and
requires the step-2 bundle to be live first.

1. **Tasks 1–2** → Migration A to staging, then production. Additive and inert.
2. **Tasks 3–11** → deploy the client. Works against both schema states. The
   toggle is not yet reachable.
3. **Task 12** → Migration B, at low traffic, watching query errors.
4. **Task 13** → deploy the edge function.
5. **Task 14** → reveal the toggle.

**Gates.** The full 1–5 sequence runs against staging first with the entitlement
suite green there, before any step touches production. On production the suite
runs again after step 4 and must pass before step 5. The suite can only pass once
Migration B is applied, since it asserts the revokes — so it cannot gate steps
1–3, which rely on the staging rehearsal instead.

**Announce the agent-hardening change.** Migration B newly blocks agents from
financial DML and from the direct salary/retainer access they hold today. Default
`true` makes it inert for *admins* only.
