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

  IF NOT (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on profiles — profiles_update_own would be inert. '
                    'This is exactly the class of drift this migration exists to close: '
                    '20260315_rls_security_audit.sql (the migration that enables RLS on '
                    'profiles) is recorded as applied in production but never actually ran.';
  END IF;
END $$;
