\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_nullu uuid := gen_random_uuid();
  v_removed uuid := gen_random_uuid();
  v_cli bigint;
  v_usage jsonb;
begin
  -- 'max' plan: null limits, so seeding data can't trip the count triggers.
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_other), (v_nullu);
  -- handle_new_user_workspace already created a profile (+ throwaway workspace)
  -- per user; re-point the existing rows instead of inserting (see 31_*.sql).
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;
  update profiles set conta_id = v_ws,  active_workspace_id = null  where id = v_nullu;

  -- v_ws data: 2 clientes, 1 IG account on the first, 1 hub token,
  -- 1 pending invite (EXPIRED on purpose) + 1 accepted invite,
  -- 1 live + 1 revoked mcp key, storage counter set by hand.
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C1', 'C1', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C2', 'C2', '#000');
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig-1');
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days');
  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_ws, 'p@x.com', 'agent', v_owner, 'pending',  now() - interval '1 day'),
           (v_ws, 'a@x.com', 'agent', v_owner, 'accepted', now() + interval '7 days');
  insert into mcp_api_keys (conta_id, created_by, name, token_hash, token_suffix)
    values (v_ws, v_owner, 'live', 'et-hash-live', 'aaaa'),
           (v_ws, v_owner, 'dead', 'et-hash-dead', 'bbbb');
  update mcp_api_keys set revoked_at = now() where token_hash = 'et-hash-dead';
  update workspaces set storage_used_bytes = 12345 where id = v_ws;

  -- foreign-workspace noise that must NOT leak into v_ws counts
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_other, v_ws2, 'X', 'X', '#000');

  -- act as the owner of v_ws
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_usage := workspace_usage();
  assert (v_usage->>'clients')::int = 2, format('clients: %s', v_usage->>'clients');
  assert (v_usage->>'team_members')::int = 1, format('team_members: %s', v_usage->>'team_members');
  assert (v_usage->>'pending_invites')::int = 1,
    'expired-but-unprocessed pending invite must still count (mirrors invite-actions)';
  assert (v_usage->>'leads')::int = 0, format('leads: %s', v_usage->>'leads');
  assert (v_usage->>'hub_tokens')::int = 1, format('hub_tokens: %s', v_usage->>'hub_tokens');
  assert (v_usage->>'workflow_templates')::int = 0, 'workflow_templates';
  assert (v_usage->>'instagram_accounts')::int = 1, 'instagram via clientes join';
  assert (v_usage->>'mcp_keys')::int = 1, 'revoked mcp key must free the slot';
  assert (v_usage->>'storage_used_bytes')::bigint = 12345, 'storage_used_bytes';

  -- scoping: the other owner sees only their own workspace
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_usage := workspace_usage();
  assert (v_usage->>'clients')::int = 1, 'foreign workspace must not leak';
  assert (v_usage->>'instagram_accounts')::int = 0, 'ig scoping';

  -- NULL active workspace: fail-safe empty object, no error
  perform set_config('request.jwt.claims', json_build_object('sub', v_nullu)::text, true);
  assert workspace_usage() = '{}'::jsonb, 'null conta must return {}';

  -- Stale active_workspace_id pointer: membership deleted, pointer not yet cleared
  -- (the removal-flow race window). Deleting workspace_members does not fire the
  -- profile-validation trigger, so this reproduces the race without extra hoops.
  -- Placed after the owner/other/nullu assertions above so team_members = 1 stays
  -- true at the point those assertions run.
  insert into auth.users (id) values (v_removed);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_removed, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_removed;
  delete from workspace_members where user_id = v_removed and workspace_id = v_ws;

  perform set_config('request.jwt.claims', json_build_object('sub', v_removed)::text, true);
  assert workspace_usage() = '{}'::jsonb,
    'stale active_workspace_id pointer must not leak counts';

  raise notice 'PASS 07_workspace_usage counts + scoping';
end $$;
rollback;

-- Grant surface: authenticated + service_role only.
do $$
begin
  assert has_function_privilege('anon', 'public.workspace_usage()', 'EXECUTE') = false,
    'anon must NOT execute workspace_usage';
  assert has_function_privilege('authenticated', 'public.workspace_usage()', 'EXECUTE') = true,
    'authenticated must execute workspace_usage';
  assert has_function_privilege('service_role', 'public.workspace_usage()', 'EXECUTE') = true,
    'service_role must keep execute (PUBLIC revoke strips it without the explicit grant)';
  raise notice 'PASS 07_workspace_usage grants';
end $$;
