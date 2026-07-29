# Profiles Tenant-Selector Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `profiles.conta_id`, `profiles.active_workspace_id` and `profiles.role` unwritable by the client, so a user can no longer point their own tenant selector at another workspace, and stop `manage-workspace-user` authorizing from the global `profiles.role`.

**Architecture:** Expand/contract, the same shape the financial-visibility work used. First an additive migration creates a `switch_workspace()` RPC that verifies membership; then the client moves its three direct-UPDATE call sites onto it and ships; only then does the breaking migration revoke the column privileges. The edge-function fix is independent and can land at any point.

**Tech Stack:** PostgreSQL 15 (Supabase), PL/pgSQL, Deno edge functions, React 19 + TypeScript, Vitest, psql-based entitlement suites.

## Global Constraints

- **The column-grant revocation is the fix. The `WITH CHECK` is not.** A `WITH CHECK (auth.uid() = id)` remains satisfied while `conta_id` changes, so RLS alone cannot stop this. Do not treat the policy rewrite as sufficient.
- **Deploy order is load-bearing:** Task 1 migration → Task 2 client deployed → Task 3 migration. Applying Task 3 before the client ships breaks workspace switching, and `Sidebar.tsx` discards the error and reloads, so it fails *silently*.
- Migration filenames use a unique timestamp prefix. This plan uses `20260729000001` and `20260729000002`; the `migration-version-guard` CI job fails on duplicates.
- Every migration ends with post-conditions asserting its own final state. Assert the **exact** set, not a count alone — a substitution keeps a count unchanged.
- Entitlement suites that impersonate `authenticated` must call `et_grant_hosted_parity(p_exclude)` **inside** each `begin;`/`rollback;` block, never at file scope: `GRANT` before any open transaction autocommits and leaks into later suites. See `supabase/tests/entitlements/52_financial_enforcement.sql` for the worked example.
- A suite asserting privileges on a table **must** exclude that table from `et_grant_hosted_parity`, or the helper re-grants `ALL` and silently undoes the thing under test.
- RLS denies by filtering, not by raising. Every denial assertion must check the affected-row count **and** that the underlying data is unchanged.
- Roles are `owner | admin | agent`. Per-workspace role comes from `workspace_members.role`; `profiles.role` is global and stale across workspaces.
- Never log or return raw error detail from an edge function. Generic message out, detail to the internal log.
- Run before pushing: `npm run lint`, `npm run format:check`, `npm run test`, `npm run test:functions`, `bash scripts/test-entitlements.sh`.

## Scope

**In scope.** The `profiles` write lockdown (Findings 1) and the `manage-workspace-user` authorization fix — together these are the documented takeover chain in `docs/superpowers/specs/2026-07-28-rls-drift-reconciliation-scope.md`.

**Explicitly out of scope**, and why:

- `mcp-keys`, `billing-portal`, `billing-checkout` also authorize from `profiles.role`. After Task 3, that role can no longer be *forged*; it remains *stale* across workspaces, which requires the attacker to already hold dual membership. That is Finding 2, a separate slice, and it uses the identical fix pattern from Task 4.
- The ~15 edge functions that derive tenancy from `profiles.conta_id` (`file-upload-url`, `sign-r2-urls`, `post-media-manage`, `instagram-publish`, `tiktok-publish` and others) need **no change**. Task 3 makes that column trustworthy, which closes all of them at the source. Changing 15 functions individually would be slower and less reliable than fixing the one write.
- Converging the `profiles` INSERT/SELECT policy names to the `20260315` scheme. This plan touches the UPDATE policy only. Finding 3.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260729000001_switch_workspace_rpc.sql` | Create the membership-checking `switch_workspace()` RPC. Additive, no behaviour change. |
| `supabase/tests/entitlements/55_switch_workspace_rpc.sql` | Prove the RPC: authorized switch works, non-member refused, `anon` cannot execute. |
| `apps/crm/src/store/workspace.ts` | `switchWorkspace()` calls the RPC instead of updating `profiles`. |
| `apps/crm/src/components/layout/Sidebar.tsx` | Use `switchWorkspace()`; stop swallowing the error. |
| `apps/crm/src/lib/supabase.ts` | Legacy DOM switcher calls the RPC. |
| `supabase/migrations/20260729000002_profiles_write_lockdown.sql` | Revoke table UPDATE, grant the six safe columns, replace the UPDATE policy, assert the final state. |
| `supabase/tests/entitlements/56_profiles_write_lockdown.sql` | Prove the lockdown: tenant/role writes denied, safe edits still work. |
| `supabase/functions/manage-workspace-user/index.ts` | Derive caller role and workspace from `workspace_members`, not `profiles`. |
| `supabase/functions/__tests__/manage-workspace-user-authz_test.ts` | Prove the stale-role path is refused. |
| `.github/workflows/ci.yml` | Add the job that runs `scripts/test-entitlements.sh`, so these suites actually gate merges. |

---

### Task 1: `switch_workspace()` RPC

**Files:**
- Create: `supabase/migrations/20260729000001_switch_workspace_rpc.sql`
- Create: `supabase/tests/entitlements/55_switch_workspace_rpc.sql`

**Interfaces:**
- Consumes: `public.workspace_members(user_id uuid, workspace_id uuid, role text)`; `public.profiles(id uuid, active_workspace_id uuid, conta_id uuid)`.
- Produces: `public.switch_workspace(p_workspace uuid) RETURNS void`. Raises `not_authenticated` or `not_a_member`. `EXECUTE` granted to `authenticated` only. Task 2 calls this as `supabase.rpc('switch_workspace', { p_workspace: workspaceId })`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729000001_switch_workspace_rpc.sql`:

```sql
-- =============================================================
-- switch_workspace() — the only sanctioned way to move a user between
-- workspaces once 20260729000002 revokes the client's UPDATE privilege on
-- profiles.active_workspace_id / profiles.conta_id.
--
-- WHY THIS EXISTS. Production allows any authenticated user to run
--   UPDATE profiles SET conta_id = '<any workspace uuid>' WHERE id = auth.uid()
-- because profiles carries GRANT ALL to authenticated, its UPDATE policy omits
-- WITH CHECK (so USING is reused, and `auth.uid() = id` stays true while you
-- rewrite your own tenant selector), and the only trigger guards
-- active_workspace_id alone. conta_id is read by the legacy FOR ALL policies via
-- get_user_conta_id(), and by ~15 edge functions as their tenant scope. Verified
-- reproducible: an attacker with no membership in the victim workspace goes from
-- 0 visible rows to 1 with that single statement.
--
-- ADDITIVE. This migration changes no privilege and no policy; it only adds the
-- function the client must be moved onto BEFORE the revocation lands.
-- =============================================================

CREATE OR REPLACE FUNCTION public.switch_workspace(p_workspace uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Identity comes from the JWT, never from a parameter. A p_user argument
  -- would let any caller move any other user between workspaces.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
     WHERE user_id = v_uid AND workspace_id = p_workspace
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  -- Both selectors in ONE statement. Two statements would leave a window in
  -- which conta_id and active_workspace_id disagree, and conta_id is what the
  -- legacy policies read.
  UPDATE public.profiles
     SET active_workspace_id = p_workspace,
         conta_id            = p_workspace
   WHERE id = v_uid;
END;
$$;

-- Supabase's default privileges grant new functions in `public` directly to
-- anon, authenticated and service_role. REVOKE FROM PUBLIC alone leaves those
-- intact, so the named roles must be enumerated.
REVOKE ALL ON FUNCTION public.switch_workspace(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_workspace(uuid) TO authenticated;

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  v_secdef boolean;
  v_path   text;
BEGIN
  SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_secdef, v_path
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'switch_workspace';

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'switch_workspace must be SECURITY DEFINER — as INVOKER it '
                    'cannot write the columns the next migration revokes';
  END IF;
  IF coalesce(v_path, '') NOT LIKE '%search_path=public, pg_temp%' THEN
    RAISE EXCEPTION 'switch_workspace lost its pinned search_path (got: %)', v_path;
  END IF;

  IF has_function_privilege('anon', 'public.switch_workspace(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not hold EXECUTE on switch_workspace';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.switch_workspace(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on switch_workspace';
  END IF;
END $$;
```

- [ ] **Step 2: Apply it locally and confirm it fails nothing**

Run: `npx supabase migration up --local`
Expected: applies cleanly, no `ERROR`.

- [ ] **Step 3: Write the suite**

Create `supabase/tests/entitlements/55_switch_workspace_rpc.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- switch_workspace() is the replacement for the client's direct UPDATE of
-- profiles.active_workspace_id / conta_id. Its whole value is the membership
-- check, so the non-member case below is the load-bearing test.

-- =============================================================
-- 1. anon cannot execute it at all.
-- =============================================================
begin;
do $$
declare v_denied boolean := false;
begin
  set local role anon;
  begin
    perform public.switch_workspace(gen_random_uuid());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'anon must not be able to execute switch_workspace';
  end if;
end $$;
rollback;

-- =============================================================
-- 2. A member can switch; a non-member cannot. Both directions in one
--    transaction so the positive case proves the negative is not simply
--    "everything fails".
-- =============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a   uuid;
  v_ws_b   uuid;
  v_uid    uuid := gen_random_uuid();
  v_got    uuid;
  v_denied boolean := false;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_uid);
  -- Member of A only.
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Positive: switching to a workspace we belong to succeeds and moves BOTH
  -- selectors. Checking only active_workspace_id would miss a partial write,
  -- and conta_id is the column the legacy policies actually read.
  perform public.switch_workspace(v_ws_a);
  reset role;
  select active_workspace_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'authorized switch did not set active_workspace_id (got %)', v_got;
  end if;
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'authorized switch did not set conta_id (got %)', v_got;
  end if;

  -- Negative: workspace B, where we hold no membership.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    perform public.switch_workspace(v_ws_b);
  exception when others then
    v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'switch_workspace allowed a non-member to switch';
  end if;

  -- And the refusal left nothing behind.
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'refused switch still mutated conta_id (got %)', v_got;
  end if;

  raise notice '55_switch_workspace_rpc: member switches, non-member refused';
end $$;
rollback;
```

- [ ] **Step 4: Run the suite**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS supabase/tests/entitlements/55_switch_workspace_rpc.sql`, `ran=18  failures=0`.

- [ ] **Step 5: Prove the suite is not vacuous**

Temporarily weaken the RPC by commenting out its `IF NOT EXISTS (…) RAISE EXCEPTION 'not_a_member'` block, re-apply with `npx supabase db reset --local`, and re-run the suite.
Expected: `FAIL … 55_switch_workspace_rpc.sql` with `switch_workspace allowed a non-member to switch`.
Then restore the block and `npx supabase db reset --local` again. Confirm `ran=18 failures=0` before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729000001_switch_workspace_rpc.sql supabase/tests/entitlements/55_switch_workspace_rpc.sql
git commit -m "feat(rls): add membership-checking switch_workspace() RPC"
```

---

### Task 2: Move the three switch call sites onto the RPC

**Files:**
- Modify: `apps/crm/src/store/workspace.ts:95-107`
- Modify: `apps/crm/src/components/layout/Sidebar.tsx:74-81`
- Modify: `apps/crm/src/lib/supabase.ts:127-139`
- Test: `apps/crm/src/__tests__/store.core.test.ts:93-106`
- Test: `apps/crm/src/lib/__tests__/supabase.test.ts:213-224`

**Interfaces:**
- Consumes: `public.switch_workspace(p_workspace uuid)` from Task 1.
- Produces: `switchWorkspace(workspaceId: string): Promise<void>` in `store/workspace.ts`, unchanged in signature. `Sidebar.tsx` and `lib/supabase.ts` both call the RPC directly rather than importing the store, matching how they call Supabase today.

- [ ] **Step 1: Update the failing test in `store.core.test.ts`**

Replace lines 93-106 with:

```ts
  it('updates the active workspace and clears the cached profile', async () => {
    mockedSupabase.__queueSupabaseResult('rpc:switch_workspace', 'rpc', {
      data: null,
      error: null,
    });

    await store.switchWorkspace('conta-9');

    expect(getLastCall('rpc:switch_workspace')).toMatchObject({
      operation: 'rpc',
      payload: { p_workspace: 'conta-9' },
    });
    await expect(supabaseModule.getCurrentProfile()).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- store.core`
Expected: FAIL — the store still calls `.from('profiles').update(...)`, so no `rpc:switch_workspace` call is recorded.

- [ ] **Step 3: Point the store at the RPC**

In `apps/crm/src/store/workspace.ts`, replace the body of `switchWorkspace`:

```ts
export async function switchWorkspace(workspaceId: string): Promise<void> {
  // Goes through the RPC, not a direct UPDATE: profiles.active_workspace_id and
  // profiles.conta_id are not writable by the client, because conta_id is the
  // tenant selector the legacy RLS policies and ~15 edge functions read.
  // See migration 20260729000002.
  const { error } = await supabase.rpc('switch_workspace', {
    p_workspace: workspaceId,
  });
  if (error) throw error;
  // Clear cached profile so next call fetches fresh data
  clearProfileCache();
}
```

The `supabase.auth.getUser()` lookup that preceded it is no longer needed — the RPC takes the caller's identity from the JWT. Delete it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test -- store.core`
Expected: PASS.

- [ ] **Step 5: Update the `supabase.test.ts` assertion**

In `apps/crm/src/lib/__tests__/supabase.test.ts`, replace the assertion block at lines 213-224 with:

```ts
    await waitFor(() => {
      expect(
        queryMock.calls.some(
          (call) =>
            call.table === 'rpc:switch_workspace' &&
            call.operation === 'rpc' &&
            (call.payload as Record<string, string>).p_workspace === 'w-2',
        ),
      ).toBe(true);
    });
```

- [ ] **Step 6: Point the legacy DOM switcher at the RPC**

In `apps/crm/src/lib/supabase.ts`, replace the click handler body at lines 127-139:

```ts
        btn.addEventListener('click', async () => {
          try {
            const { error: switchErr } = await supabase.rpc('switch_workspace', {
              p_workspace: m.workspaces.id,
            });
            if (switchErr) throw switchErr;
            cachedProfile = null;
            window.location.reload();
          } catch (e) {
            console.error('Workspace switch error:', e);
          }
        });
```

- [ ] **Step 7: Point the Sidebar at the store, and stop swallowing the error**

In `apps/crm/src/components/layout/Sidebar.tsx`, replace `handleWorkspaceSwitch` at lines 74-81:

```tsx
  const handleWorkspaceSwitch = async (workspaceId: string) => {
    if (!user) return;
    try {
      await switchWorkspace(workspaceId);
      window.location.reload();
    } catch {
      // Previously the error was discarded and the page reloaded regardless, so
      // a refused switch was indistinguishable from a successful one.
      toast.error('Não foi possível trocar de workspace.');
    }
  };
```

Add the imports at the top of the file if absent:

```tsx
import { toast } from 'sonner';
import { switchWorkspace } from '@/store/workspace';
```

- [ ] **Step 8: Run the full frontend suite and typecheck**

Run: `npm run test && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 9: Verify in the browser**

Start the CRM against staging (`npm run dev:staging`), sign in as a user who belongs to two workspaces, and switch between them via the sidebar. Confirm the workspace actually changes and data reloads. This cannot be proved by jsdom — the switch reloads the page.

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/store/workspace.ts apps/crm/src/components/layout/Sidebar.tsx apps/crm/src/lib/supabase.ts apps/crm/src/__tests__/store.core.test.ts apps/crm/src/lib/__tests__/supabase.test.ts
git commit -m "refactor(crm): switch workspaces through the RPC, not a direct profiles write"
```

---

### Task 3: The lockdown migration

**Do not start this task until Task 2 is deployed to production.** The revocation breaks any client still issuing the direct UPDATE.

**Files:**
- Create: `supabase/migrations/20260729000002_profiles_write_lockdown.sql`
- Create: `supabase/tests/entitlements/56_profiles_write_lockdown.sql`

**Interfaces:**
- Consumes: `public.switch_workspace(p_workspace uuid)` from Task 1 — it is the only remaining write path for the two selector columns.
- Produces: `authenticated` holds `UPDATE` on exactly `nome, empresa, telefone, whatsapp, marketing_opt_in, onboarding_complete`. Policy `profiles_update_own` replaces `"Users can update own profile"`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729000002_profiles_write_lockdown.sql`:

```sql
-- =============================================================
-- profiles write lockdown (BREAKING) — closes the cross-tenant takeover.
--
-- REQUIRES the client bundle from Task 2 to be deployed first. It revokes the
-- table-level UPDATE that Sidebar.tsx / lib/supabase.ts / store/workspace.ts
-- relied on for workspace switching. Sidebar previously discarded the error and
-- reloaded anyway, so applying this against the old client fails SILENTLY.
--
-- THE REVOCATION IS THE FIX, NOT THE POLICY. A WITH CHECK of `auth.uid() = id`
-- stays true while the row's conta_id is rewritten, so no RLS expression short
-- of a self-referential subquery can stop this. Column privilege can, and does.
-- The policy is replaced anyway because the missing WITH CHECK is a real defect
-- (Postgres silently reuses USING), but it is defence, not the mechanism.
--
-- COLUMN LIST. These six are every column the CRM writes with the user's own
-- JWT, verified against the call sites:
--   nome, empresa, telefone, whatsapp, marketing_opt_in  PerfilTab.tsx:48
--   nome, empresa                                        WorkspaceSetupPage.tsx:43
--   onboarding_complete, nome                            ConfigurarSenhaPage.tsx:161
-- Deliberately EXCLUDED: role, conta_id, active_workspace_id (the attack
-- surface); id (would let a row be re-keyed); avatar_url and whatsapp_opt_in
-- (no client write path exists — grep confirms zero call sites, so granting
-- them would widen the surface for nothing).
--
-- service_role keeps everything. manage-workspace-user legitimately writes
-- profiles.role and both selector columns for OTHER users during update-role
-- and remove, and it uses a service-role client.
-- =============================================================

REVOKE UPDATE ON public.profiles FROM authenticated, anon;

GRANT UPDATE (
  nome, empresa, telefone, whatsapp, marketing_opt_in, onboarding_complete
) ON public.profiles TO authenticated;

-- Both names are dropped: production carries "Users can update own profile",
-- while databases built from migrations carry profiles_update_own from
-- 20260315 (which production never actually ran). Dropping both converges them.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'empresa', 'marketing_opt_in', 'nome', 'onboarding_complete',
    'telefone', 'whatsapp'];
  v_actual   text[];
  v_stray    text;
BEGIN
  -- One assertion covers both failure modes. column_privileges reports every
  -- column reachable through a table-level grant too, so a surviving
  -- GRANT UPDATE ON profiles shows up here as all 14 columns rather than 6 --
  -- verified empirically. An exact-set check therefore catches both a leftover
  -- table grant and a wrong column list.
  SELECT array_agg(column_name ORDER BY column_name) INTO v_actual
    FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='profiles'
     AND grantee='authenticated' AND privilege_type='UPDATE';

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'authenticated UPDATE columns on profiles are %, expected %',
      coalesce(array_to_string(v_actual, ','), '<none>'),
      array_to_string(v_expected, ',');
  END IF;

  -- Named explicitly as well as by the set check above, because these three are
  -- the whole point and a future edit to v_expected must not quietly re-add one.
  SELECT string_agg(column_name, ', ') INTO v_stray
    FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='profiles'
     AND grantee IN ('authenticated','anon') AND privilege_type='UPDATE'
     AND column_name IN ('role','conta_id','active_workspace_id','id');
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION 'client retains UPDATE on protected profiles column(s): %', v_stray;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema='public' AND table_name='profiles'
       AND grantee='anon' AND privilege_type='UPDATE'
  ) THEN
    RAISE EXCEPTION 'anon retains UPDATE on profiles';
  END IF;

  -- Exactly one UPDATE policy, ours, and it must carry a WITH CHECK. A NULL
  -- with_check is precisely the defect this migration exists to remove: Postgres
  -- silently reuses USING, which reads as correct and is not.
  SELECT string_agg(format('%s(with_check=%s)', policyname,
                           coalesce(with_check, 'NULL')), ', ' ORDER BY policyname)
    INTO v_stray
    FROM pg_policies
   WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE'
     AND (policyname <> 'profiles_update_own' OR with_check IS NULL);
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected or WITH CHECK-less UPDATE policy on profiles: %', v_stray;
  END IF;
END $$;
```

- [ ] **Step 2: Apply locally**

Run: `npx supabase db reset --local`
Expected: every migration applies, no `ERROR`.

- [ ] **Step 3: Write the suite**

Create `supabase/tests/entitlements/56_profiles_write_lockdown.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- The cross-tenant takeover, inverted into a regression test.
--
-- Production allowed: UPDATE profiles SET conta_id = '<victim ws>' WHERE
-- id = auth.uid(). conta_id is read by the legacy FOR ALL policies through
-- get_user_conta_id() and by ~15 edge functions as their tenant scope, so one
-- statement against your own row bought another workspace's data. Reproduced
-- before the fix: 0 rows visible, one UPDATE, 1 row visible.
--
-- profiles is EXCLUDED from et_grant_hosted_parity: this suite asserts the
-- migration's own column-level grant/revoke on that table, and a wholesale
-- re-grant would undo exactly what is under test. The suite still needs SELECT
-- so it can read rows back; that is granted explicitly below, deliberately
-- WITHOUT update. Both statements go inside each begin/rollback block, never at
-- file scope -- GRANT before an open transaction autocommits and leaks into
-- later suites (see 52_financial_enforcement.sql).

-- =============================================================
-- 1. The tenant selector and the role are not writable by their owner.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws_a   uuid;
  v_ws_b   uuid;
  v_uid    uuid := gen_random_uuid();
  v_col    text;
  v_got    uuid;
  v_role   text;
  v_rows   int;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a,
                      role = 'owner'
   where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Each protected column, individually. Privilege denial RAISES (unlike RLS,
  -- which filters), so a plain exception check is the right shape here.
  foreach v_col in array ARRAY['conta_id','active_workspace_id'] loop
    begin
      execute format('update public.profiles set %I = $1 where id = $2', v_col)
        using v_ws_b, v_uid;
      reset role;
      raise exception 'client was able to write profiles.%', v_col;
    exception when insufficient_privilege then
      null;  -- expected
    end;
  end loop;

  begin
    update public.profiles set role = 'owner'::public.user_role where id = v_uid;
    reset role;
    raise exception 'client was able to write profiles.role';
  exception when insufficient_privilege then
    null;  -- expected
  end;

  reset role;

  -- Denial must also have changed nothing. A test that only asserts "it threw"
  -- would pass against a broken implementation that threw after writing.
  select conta_id into v_got from profiles where id = v_uid;
  if v_got is distinct from v_ws_a then
    raise exception 'conta_id changed despite the denial (got %)', v_got;
  end if;
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'owner' then
    raise exception 'role changed despite the denial (got %)', v_role;
  end if;

  raise notice '56: tenant selector and role are not client-writable';
end $$;
rollback;

-- =============================================================
-- 2. The positive counterpart. Without it, a revoke that was far too broad --
--    say, all UPDATE removed -- would pass section 1 and break every profile
--    edit in the app.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws   uuid;
  v_uid  uuid := gen_random_uuid();
  v_nome text;
  v_ob   boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Every column the app actually writes, not a representative sample: a grant
  -- that dropped one of them would break a real screen and go uncaught.
  update public.profiles
     set nome = 'Ana', empresa = 'Mesaas', telefone = '11999',
         whatsapp = '11888', marketing_opt_in = true, onboarding_complete = true
   where id = v_uid;

  reset role;
  select nome, onboarding_complete into v_nome, v_ob from profiles where id = v_uid;
  if v_nome is distinct from 'Ana' or v_ob is not true then
    raise exception 'a permitted profile edit did not persist (nome=%, ob=%)',
      v_nome, v_ob;
  end if;

  raise notice '56: permitted profile edits still work';
end $$;
rollback;

-- =============================================================
-- 3. A user cannot edit SOMEONE ELSE's profile. This is the RLS half rather
--    than the privilege half, so it denies by filtering: assert the affected
--    row count is zero AND the victim's data is untouched.
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['profiles']);
grant select on public.profiles to authenticated;
do $$
declare
  v_ws     uuid;
  v_uid    uuid := gen_random_uuid();
  v_victim uuid := gen_random_uuid();
  v_rows   int;
  v_nome   text;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_uid), (v_victim);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner'), (v_victim, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws,
                      nome = 'Victim'
   where id = v_victim;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  update public.profiles set nome = 'Hacked' where id = v_victim;
  get diagnostics v_rows = ROW_COUNT;
  reset role;

  if coalesce(v_rows, -1) <> 0 then
    raise exception 'edited another user''s profile: % row(s)', v_rows;
  end if;
  select nome into v_nome from profiles where id = v_victim;
  if v_nome is distinct from 'Victim' then
    raise exception 'victim profile was modified (nome=%)', v_nome;
  end if;

  raise notice '56: cannot edit another user''s profile';
end $$;
rollback;
```

- [ ] **Step 4: Run the suite**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS supabase/tests/entitlements/56_profiles_write_lockdown.sql`, `ran=19  failures=0`.

- [ ] **Step 5: Prove section 1 is not vacuous**

Temporarily add `conta_id` to the `GRANT UPDATE (...)` list in the migration, run `npx supabase db reset --local`, and re-run the suite.
Expected: the migration's own post-condition aborts first with `client retains UPDATE on protected profiles column(s): conta_id`. Then remove `conta_id` from the *post-condition's* protected list too and reset again.
Expected: suite 56 now fails with `client was able to write profiles.conta_id`.
Restore both, `npx supabase db reset --local`, and confirm `ran=19 failures=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729000002_profiles_write_lockdown.sql supabase/tests/entitlements/56_profiles_write_lockdown.sql
git commit -m "fix(rls): revoke client writes to the profiles tenant selector and role"
```

---

### Task 4: `manage-workspace-user` authorizes from `workspace_members`

**Files:**
- Modify: `supabase/functions/manage-workspace-user/index.ts:120-265`
- Create: `supabase/functions/__tests__/manage-workspace-user-authz_test.ts`

**Interfaces:**
- Consumes: `workspace_members(user_id, workspace_id, role)`; `profiles.active_workspace_id`.
- Produces: no signature change. `update-role`, `remove` and `cancel-invite` now scope to the caller's *membership* workspace and check the caller's *per-workspace* role.

- [ ] **Step 1: Replace the caller lookup**

In `supabase/functions/manage-workspace-user/index.ts`, replace lines 120-134 (the `callerProfile` block and its role check) with:

```ts
    // All administrative actions below are scoped to the caller's current
    // workspace, resolved from their MEMBERSHIP rather than from profiles.
    //
    // profiles.role is global, not per-workspace: switching workspaces never
    // rewrites it, so an owner in workspace A who is an agent in workspace B
    // kept `owner` while working in B. profiles.conta_id was worse still --
    // until 20260729000002 the client could write it directly, so both the role
    // and the workspace this function trusted were attacker-controlled, and it
    // acts through a service-role client that bypasses RLS entirely.
    //
    // This mirrors set-financial-access above, which already does it correctly.
    const { data: callerProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile?.active_workspace_id) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403, headers });
    }
    const workspaceId = callerProfile.active_workspace_id;

    const { data: callerMembership, error: membershipError } = await serviceClient
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .single();

    if (membershipError || !callerMembership) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers });
    }

    const callerRole = callerMembership.role;
    if (callerRole !== "owner" && callerRole !== "admin") {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers });
    }
```

- [ ] **Step 2: Replace every remaining reference**

In the same file, substitute throughout the rest of the handler:

- `callerProfile.conta_id` → `workspaceId` (lines 151, 177, 208, 217, 222, 227, 238, 259, 264)
- `callerProfile.role` → `callerRole` (lines 185, 200)

Verify none remain:

```bash
grep -n 'callerProfile\.' supabase/functions/manage-workspace-user/index.ts
```
Expected: no output.

- [ ] **Step 3: Write the test**

Create `supabase/functions/__tests__/manage-workspace-user-authz_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// The caller's role and workspace must come from workspace_members, never from
// profiles. profiles.role is global -- an owner in workspace A who is an agent
// in workspace B carried `owner` into B -- and until 20260729000002 the client
// could write profiles.conta_id directly. This function acts through a
// service-role client that bypasses RLS, so it is the last line of defence.

/** Mirrors the authorization block in index.ts. */
function authorize(
  profile: { active_workspace_id: string | null } | null,
  membership: { role: string } | null,
): { status: number; workspaceId?: string; role?: string } {
  if (!profile?.active_workspace_id) return { status: 403 };
  if (!membership) return { status: 403 };
  if (membership.role !== "owner" && membership.role !== "admin") return { status: 403 };
  return { status: 200, workspaceId: profile.active_workspace_id, role: membership.role };
}

Deno.test("agent in the active workspace is refused, whatever profiles.role says", () => {
  // The stale-role case: this user is an owner elsewhere, an agent here.
  const result = authorize({ active_workspace_id: "ws-b" }, { role: "agent" });
  assertEquals(result.status, 403);
});

Deno.test("non-member of the active workspace is refused", () => {
  const result = authorize({ active_workspace_id: "ws-b" }, null);
  assertEquals(result.status, 403);
});

Deno.test("caller with no active workspace is refused", () => {
  const result = authorize({ active_workspace_id: null }, { role: "owner" });
  assertEquals(result.status, 403);
});

Deno.test("owner of the active workspace is allowed, scoped to that workspace", () => {
  const result = authorize({ active_workspace_id: "ws-a" }, { role: "owner" });
  assertEquals(result.status, 200);
  assertEquals(result.workspaceId, "ws-a");
  assertEquals(result.role, "owner");
});

Deno.test("admin of the active workspace is allowed", () => {
  const result = authorize({ active_workspace_id: "ws-a" }, { role: "admin" });
  assertEquals(result.status, 200);
});
```

- [ ] **Step 4: Run the edge-function suite**

Run: `npm run test:functions`
Expected: the five new tests pass, and nothing else regresses.

Then restore the lockfile, which this command always dirties:

```bash
git checkout -- deno.lock
```

- [ ] **Step 5: Check the sibling suites still hold**

Run: `npm run test:functions -- --filter "workspace"`
Expected: `manage-workspace-invite-contract_test.ts` and `workspace-invite-security_test.ts` pass. If either asserted the old `profiles.role` shape, update it to the membership shape rather than weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/manage-workspace-user/index.ts supabase/functions/__tests__/manage-workspace-user-authz_test.ts
git commit -m "fix(authz): scope manage-workspace-user to the caller's membership, not profiles.role"
```

---

### Task 5: Run the entitlement suites in CI

Without this, suites 55 and 56 — the only proof the P0 stays closed — never run on `main`.

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/test-entitlements.sh`, which reads `SUPABASE_DB_URL` and defaults to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Produces: a CI job named `entitlement-tests`.

- [ ] **Step 1: Read the existing workflow**

Run: `cat .github/workflows/ci.yml`
Note how `edge-function-tests` declares its runner, its checkout step and its Node/Deno setup — match that style rather than inventing a new one.

- [ ] **Step 2: Add the job**

Append to the `jobs:` map in `.github/workflows/ci.yml`:

```yaml
  entitlement-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start Supabase
        run: supabase start
      - name: Run entitlement suites
        run: bash scripts/test-entitlements.sh
```

- [ ] **Step 3: Verify the script works from a clean database**

Run: `npx supabase db reset --local && bash scripts/test-entitlements.sh`
Expected: `ran=19  failures=0`. This is what CI will do, so it must pass from a reset, not only from your working database.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the entitlement SQL suites"
```

---

## Deployment runbook

The ordering is the whole point. Do not compress it.

1. **Apply `20260729000001`** (the RPC) to staging, then production. Additive — nothing depends on it yet.
   ```bash
   npx supabase db push --linked
   ```
   Confirm the linked project first: `cat supabase/.temp/project-ref` — `skjzpekeqefvlojenfsw` is **production**, `wlyzhyfondykzpsiqsce` is staging. The link state flips; never assume.
2. **Merge and deploy the Task 2 client.** Verify workspace switching works in production before continuing. At this point both paths function: the RPC exists and the direct UPDATE is still permitted.
3. **Apply `20260729000002`** (the revocation). The old client is gone by now, so nothing breaks. If a switch fails after this, the cause is a client still on the previous bundle.
4. **Deploy `manage-workspace-user`.** Independent of 1–3; can go earlier if preferred.
   ```bash
   npx supabase functions deploy manage-workspace-user --use-api
   ```
   `--use-api` because the local Docker bundler is broken in this repo.

**Rollback.** Step 3 is the only breaking step, and it reverses cleanly:

```sql
GRANT UPDATE ON public.profiles TO authenticated;
```

That restores the previous behaviour — including the vulnerability — so treat it as an emergency measure and re-apply the migration once the client is sorted. Steps 1 and 4 are additive and need no rollback.

## Verification that the P0 is actually closed

After step 3, re-run the original reproduction against a local database built from the new migrations:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f docs/superpowers/specs/2026-07-28-finding1-reproduction.sql
```

Expected: the `UPDATE profiles SET conta_id = <victim_ws>` step now fails with `insufficient_privilege`, and the final notice reads `>>> not exploitable by this path <<<` instead of `>>> EXPLOIT CONFIRMED <<<`.

Note that the reproduction recreates production's *legacy* policies on `clientes` deliberately. Those remain in place after this plan — Finding 3 removes them. What changes is that the attacker can no longer reach them, because the selector they keyed on is no longer writable.

## Self-review

**Spec coverage.** Spec sequencing step 2 (`profiles` lockdown) → Tasks 1–3. Step 3 (`manage-workspace-user`) → Task 4. Step 6 (CI job) → Task 5. Steps 4 (Finding 2 role audit) and 5 (Finding 3 per-command policies) are explicitly out of scope and named as such above. The spec's RPC security contract — identity from `auth.uid()`, membership check, atomic write of both columns, `SECURITY DEFINER` with pinned `search_path`, enumerated `REVOKE` then `GRANT EXECUTE` — is implemented in Task 1 and asserted by its post-condition. The spec's five required test cases map to: cross-tenant denial (suite 56 §1), non-member switch denied (suite 55 §2), `role` update denied (suite 56 §1), safe edits still work (suite 56 §2), per-workspace role (Task 4 test).

**Known gap.** The spec also lists a `manage-workspace-user` denial test hitting the deployed function end to end. Task 4's test covers the authorization *logic* extracted as a pure function, not the wired handler — the existing edge-function suites in this repo are unit-shaped and there is no harness for booting a function against a live database. An end-to-end test would need that harness built first, which is its own piece of work.

**Type consistency.** `switch_workspace(p_workspace uuid)` is named identically in the migration, both client call sites, and the store; the RPC payload key is `p_workspace` in Task 1, Task 2's store call, and both updated test assertions. `workspaceId` and `callerRole` are introduced once in Task 4 step 1 and used consistently in step 2.
