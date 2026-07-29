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
