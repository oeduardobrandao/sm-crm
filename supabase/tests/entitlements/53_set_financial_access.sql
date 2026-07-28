\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- public.set_financial_access(p_actor, p_target, p_workspace, p_value) --
-- migration 20260728000003_set_financial_access_rpc.sql -- is the SOLE
-- enforcement point for who may change financial-visibility access: the
-- edge-function handler (supabase/functions/manage-workspace-user/
-- setFinancialAccess.ts) delegates 100% of authorization to this RPC and
-- only maps its sentinel error messages onto HTTP status codes. The Deno
-- suite (supabase/functions/__tests__/set_financial_access_test.ts) mocks the
-- RPC boundary itself, so it verifies the status-code mapping and nothing
-- about the authorization logic exercised below -- a regression here would be
-- a silent privilege escalation that no existing test would catch.
--
-- Deliberately simpler than 50_/51_/52_: this function is SECURITY DEFINER
-- and takes the actor as an explicit parameter, so it never reads auth.uid()
-- or current_user -- no set_config('request.jwt.claims', ...), no SET LOCAL
-- ROLE, no et_grant_hosted_parity(). The test runs as the table owner and
-- calls the function directly, exactly as the edge function's service-role
-- client does.

begin;
do $$
declare
  v_ws          uuid;  -- "workspace A" in the cross-workspace scenario below
  v_ws_b        uuid;  -- "workspace B"
  v_owner       uuid := gen_random_uuid();
  v_admin       uuid := gen_random_uuid();
  v_agent       uuid := gen_random_uuid();
  v_unknown     uuid := gen_random_uuid();
  v_dual        uuid := gen_random_uuid();
  v_result      text;
  v_flag        boolean;
  v_audit_n     bigint;
  v_audit_conta uuid;
  v_audit_actor uuid;
  v_audit_type  text;
  v_audit_meta  jsonb;
begin
  v_ws   := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  -- auth.users insert fires handle_new_user_workspace(), which auto-creates a
  -- throwaway workspace and makes each new user its owner (20260317_
  -- multi_workspace.sql). Harmless here -- every membership/profile pointer
  -- below is set explicitly afterwards, same precedent as 50_/52_.
  insert into auth.users (id) values (v_owner), (v_admin), (v_agent), (v_dual);

  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent);

  -- v_dual: a genuine owner of workspace B who is ALSO, separately, an admin
  -- of workspace A -- profiles.role is stale at 'owner' (multi-workspace
  -- users only ever get one profiles.role, and nothing keeps it in sync with
  -- whichever workspace is currently active), and active_workspace_id
  -- currently points at A, where their real membership role is only 'admin'.
  -- This is exactly the shape of user the RPC's per-workspace lookup (never
  -- profiles.role, never "any workspace the user belongs to") exists to
  -- keep from escalating.
  insert into workspace_members (user_id, workspace_id, role) values
    (v_dual, v_ws,   'admin'),
    (v_dual, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_b, role = 'owner', active_workspace_id = v_ws
   where id = v_dual;

  -- =============================================================
  -- 1. Owner toggles an admin: returns 'updated', the flag actually flips,
  --    and exactly one audit_log row is written with the correct
  --    old_value/new_value.
  -- =============================================================
  select public.set_financial_access(v_owner, v_admin, v_ws, false) into v_result;
  if v_result is distinct from 'updated' then
    raise exception 'owner toggling admin: expected ''updated'', got %', v_result;
  end if;

  select can_see_financials into v_flag
    from workspace_members where user_id = v_admin and workspace_id = v_ws;
  if v_flag is not false then
    raise exception 'admin.can_see_financials should be false after the toggle, got %', v_flag;
  end if;

  select count(*) into v_audit_n from audit_log
   where action = 'set-financial-access' and resource_id = v_admin::text;
  if v_audit_n <> 1 then
    raise exception 'expected exactly 1 audit_log row after the toggle, got %', v_audit_n;
  end if;

  select conta_id, actor_user_id, resource_type, metadata
    into v_audit_conta, v_audit_actor, v_audit_type, v_audit_meta
    from audit_log where action = 'set-financial-access' and resource_id = v_admin::text;

  if v_audit_conta is distinct from v_ws then
    raise exception 'audit_log.conta_id should be %, got %', v_ws, v_audit_conta;
  end if;
  if v_audit_actor is distinct from v_owner then
    raise exception 'audit_log.actor_user_id should be %, got %', v_owner, v_audit_actor;
  end if;
  if v_audit_type is distinct from 'workspace_member' then
    raise exception 'audit_log.resource_type should be ''workspace_member'', got %', v_audit_type;
  end if;
  if (v_audit_meta->>'old_value')::boolean is not true then
    raise exception 'audit_log.metadata.old_value should be true, got %', v_audit_meta->>'old_value';
  end if;
  if (v_audit_meta->>'new_value')::boolean is not false then
    raise exception 'audit_log.metadata.new_value should be false, got %', v_audit_meta->>'new_value';
  end if;

  raise notice '53_set_financial_access: owner toggle updates the flag and audits correctly';

  -- =============================================================
  -- 2. Repeating the exact same value is a no-op: returns 'noop', flag
  --    unchanged, and -- crucially -- the audit row count does NOT grow.
  -- =============================================================
  select public.set_financial_access(v_owner, v_admin, v_ws, false) into v_result;
  if v_result is distinct from 'noop' then
    raise exception 'repeating the same value: expected ''noop'', got %', v_result;
  end if;

  select count(*) into v_audit_n from audit_log
   where action = 'set-financial-access' and resource_id = v_admin::text;
  if v_audit_n <> 1 then
    raise exception 'a noop call must not add an audit row, count is now %', v_audit_n;
  end if;

  raise notice '53_set_financial_access: repeat-value call is a noop and does not pad the audit trail';

  -- =============================================================
  -- 3. Non-owner actor is rejected, regardless of the target.
  -- =============================================================
  begin
    perform public.set_financial_access(v_admin, v_agent, v_ws, false);
    raise exception 'non-owner actor should have been rejected with not_owner';
  exception when others then
    if sqlerrm <> 'not_owner' then raise; end if;
  end;
  raise notice '53_set_financial_access: non-owner actor correctly rejected (not_owner)';

  -- =============================================================
  -- 4. Agent target is rejected: the flag is meaningful for admins only.
  -- =============================================================
  begin
    perform public.set_financial_access(v_owner, v_agent, v_ws, false);
    raise exception 'agent target should have been rejected with target_not_admin';
  exception when others then
    if sqlerrm <> 'target_not_admin' then raise; end if;
  end;
  raise notice '53_set_financial_access: agent target correctly rejected (target_not_admin)';

  -- =============================================================
  -- 5. Unknown target uuid (not a member of any workspace) is rejected.
  -- =============================================================
  begin
    perform public.set_financial_access(v_owner, v_unknown, v_ws, false);
    raise exception 'unknown target should have been rejected with target_not_member';
  exception when others then
    if sqlerrm <> 'target_not_member' then raise; end if;
  end;
  raise notice '53_set_financial_access: unknown target correctly rejected (target_not_member)';

  -- =============================================================
  -- 6. Cross-workspace stale-role escalation: v_dual is a genuine owner of
  --    workspace B, calling with p_workspace = B (exactly the workspace they
  --    own). v_admin is a real admin of workspace A only -- not a member of
  --    B at all. The Deno layer cannot express this (it mocks the RPC and
  --    never has real workspace_members rows to misuse); only a real lookup
  --    against workspace_members catches it. If the RPC instead trusted
  --    profiles.role (stale 'owner') or matched the target across ANY
  --    workspace the target belongs to rather than scoping strictly to
  --    p_workspace, this would incorrectly succeed instead of being rejected.
  -- =============================================================
  begin
    perform public.set_financial_access(v_dual, v_admin, v_ws_b, false);
    raise exception 'owner-of-B targeting an admin-of-A via workspace B should have been rejected with target_not_member';
  exception when others then
    if sqlerrm <> 'target_not_member' then raise; end if;
  end;
  raise notice '53_set_financial_access: cross-workspace stale-role escalation correctly rejected (target_not_member)';

  raise notice '53_set_financial_access: all six assertions passed';
end $$;
rollback;
