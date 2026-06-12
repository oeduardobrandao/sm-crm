-- Fix infinite recursion in the workspace_members SELECT policy.
--
-- The original "wm_select_same_workspace" policy (20260317_multi_workspace.sql)
-- referenced workspace_members inside its own USING clause:
--
--   USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
--
-- Evaluating it re-applies the same policy, so any read of workspace_members --
-- and any read of workspaces (whose ws_select_member / ws_update_owner policies
-- sub-select workspace_members) -- errored with:
--   "infinite recursion detected in policy for relation \"workspace_members\""
--
-- Fix: resolve the caller's workspace ids through a SECURITY DEFINER helper.
-- The function runs as its owner, so its internal read of workspace_members does
-- NOT re-trigger RLS, breaking the recursion. This mirrors get_my_conta_id().

CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "wm_select_same_workspace" ON public.workspace_members;

CREATE POLICY "wm_select_same_workspace" ON public.workspace_members
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));
