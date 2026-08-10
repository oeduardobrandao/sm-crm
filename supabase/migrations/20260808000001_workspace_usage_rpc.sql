-- Workspace-wide usage counts for the CRM "Uso do plano" panel.
-- Count expressions MIRROR the enforcement triggers (20260611130003_count_triggers.sql,
-- 20260622120001_mcp_api_keys.sql) and the invite seat pre-check
-- (supabase/functions/_shared/invite-actions.ts). Rule: usage displays mirror enforcement.
-- pending_invites deliberately has NO expiry filter: an expired-but-unprocessed invite
-- still consumes a seat at the server pre-check until it is revoked or replaced.
create or replace function public.workspace_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws uuid := public.get_my_conta_id();
begin
  if v_ws is null then
    return '{}'::jsonb;
  end if;

  -- Defense-in-depth: a stale active_workspace_id pointer (membership deleted,
  -- pointer not yet cleared) must not leak aggregate counts to a removed user.
  if not exists (
    select 1 from workspace_members
     where workspace_id = v_ws and user_id = auth.uid()
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'clients',            (select count(*) from clientes where conta_id = v_ws),
    'team_members',       (select count(*) from workspace_members where workspace_id = v_ws),
    'pending_invites',    (select count(*) from invites
                            where conta_id = v_ws and status = 'pending'),
    'leads',              (select count(*) from leads where conta_id = v_ws),
    'hub_tokens',         (select count(*) from client_hub_tokens where conta_id = v_ws),
    'workflow_templates', (select count(*) from workflow_templates where conta_id = v_ws),
    'instagram_accounts', (select count(*) from instagram_accounts t
                             join clientes c on c.id = t.client_id
                            where c.conta_id = v_ws),
    'mcp_keys',           (select count(*) from mcp_api_keys
                            where conta_id = v_ws and revoked_at is null),
    'storage_used_bytes', (select coalesce(storage_used_bytes, 0)
                             from workspaces where id = v_ws)
  );
end;
$$;

-- SECURITY DEFINER: default privileges hand EXECUTE on new public functions to
-- anon/authenticated/service_role, so lock it down explicitly.
-- NOTE: revoking PUBLIC also strips service_role; the GRANT below restores it.
revoke all on function public.workspace_usage() from public;
revoke all on function public.workspace_usage() from anon;
grant execute on function public.workspace_usage() to authenticated;
grant execute on function public.workspace_usage() to service_role;
