-- profiles SELECT: every member of the caller's ACTIVE workspace is visible,
-- not only the profiles whose conta_id equals it.
--
-- switch_workspace() (20260729000001) rewrites profiles.conta_id and
-- active_workspace_id to whichever workspace the user is in. A user who
-- belongs to two workspaces therefore has a conta_id matching only one of
-- them, and the old policy (conta_id = get_my_conta_id()) hid their profile
-- from the other one. The CRM roster (getWorkspaceUsers: workspace_members +
-- profiles!inner) dropped those members from Configurações > Membros while
-- the Admin, on the service role, still listed them and the seat count still
-- counted them. Prod had 9 memberships hidden this way on 2026-10-21.
--
-- The live policy had drifted between environments: prod carried
-- "Users can view own workspace profiles" (id = auth.uid() OR conta_id =
-- get_my_conta_id()), staging and the migrations carried
-- profiles_select_same_workspace (conta_id = get_my_conta_id() only). Both are
-- dropped and replaced by one policy that keeps both old clauses (so nothing
-- visible today disappears) and adds the active-workspace membership.
--
-- Scope stays the ACTIVE workspace, like every other tenant policy: being a
-- member of ws1 does not reveal ws1's profiles while the caller is in ws2.
--
-- The membership lookup goes through a SECURITY DEFINER helper, mirroring
-- user_workspace_ids() (20260612120000): it reads workspace_members without
-- re-entering that table's RLS for every profiles row. authenticated needs
-- EXECUTE because a policy runs as the querying role (see
-- 20260925000001_lockdown_definer_function_grants.sql). The policy is
-- TO authenticated: anon has no auth.uid(), so get_my_conta_id() is NULL and
-- the old TO public policy never matched an anon row either.

CREATE OR REPLACE FUNCTION public.active_workspace_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wm.user_id
    FROM public.workspace_members wm
   WHERE wm.workspace_id = public.get_my_conta_id();
$$;

REVOKE ALL ON FUNCTION public.active_workspace_member_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.active_workspace_member_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own workspace profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_same_workspace" ON public.profiles;

CREATE POLICY "profiles_select_same_workspace" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR conta_id = (SELECT public.get_my_conta_id())
    OR id IN (SELECT public.active_workspace_member_ids())
  );
