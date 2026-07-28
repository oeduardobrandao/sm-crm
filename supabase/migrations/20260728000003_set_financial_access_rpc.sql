-- Atomic owner-check + update + audit for the financial-access toggle.
--
-- One transaction on purpose: the sibling actions in manage-workspace-user are
-- non-transactional multi-writes (update-role writes workspace_members then
-- profiles then the audit log with no rollback path), and cancel-invite writes
-- no audit row at all. The new action must not copy that pattern.
--
-- The audit table is `audit_log` (singular) — confirmed against
-- supabase/functions/_shared/audit.ts (insertAuditLog writes to 'audit_log')
-- and its defining migration 20260416000000_audit_log.sql. The brief's draft
-- named it `audit_logs`; that table does not exist.
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

  INSERT INTO public.audit_log
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

-- -------------------------------------------------------------
-- Post-conditions
-- -------------------------------------------------------------
DO $$
DECLARE
  acl text;
BEGIN
  SELECT array_to_string(p.proacl, ',') INTO acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_financial_access';

  IF acl IS NULL OR acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'set_financial_access(): service_role lacks EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'set_financial_access(): authenticated retains EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%anon=X%' THEN
    RAISE EXCEPTION 'set_financial_access(): anon retains EXECUTE — acl=%', acl;
  END IF;
  -- A PUBLIC grant renders as a grantee-less aclitem (`=X/postgres`), not
  -- `anon=X` — textually distinct from the checks above (same caveat noted in
  -- 20260728000001's post-conditions).
  IF acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
    RAISE EXCEPTION 'set_financial_access(): PUBLIC retains EXECUTE — acl=%', acl;
  END IF;
END $$;
