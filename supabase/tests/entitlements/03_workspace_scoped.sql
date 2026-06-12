\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean;
        v_uid2 uuid; v_uid3 uuid;
begin
  -- LEADS count limit: tested on a plan WITH feature_leads (start), max_leads overridden to 2.
  -- (free has feature_leads=false, so free workspaces can't create leads at all — its enforced by
  --  the Plan 2 feature trigger and covered in 11_feature_triggers; the COUNT limit only applies
  --  on plans where the feature is enabled.)
  v_ws := et_make_workspace('start', '{"max_leads": 2}'::jsonb);
  insert into leads (user_id, conta_id, nome) values (v_uid, v_ws, 'L1');
  insert into leads (user_id, conta_id, nome) values (v_uid, v_ws, 'L2');
  v_blocked := false;
  begin insert into leads (user_id, conta_id, nome) values (v_uid, v_ws, 'L3');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'lead over limit must block';

  -- SEATS: free max_team_members = 1 (workspace_members scoped by workspace_id)
  -- workspace_members.user_id has FK -> auth.users(id); insert real users first
  v_ws := et_make_workspace('free');
  v_uid2 := gen_random_uuid();
  v_uid3 := gen_random_uuid();
  insert into auth.users (id) values (v_uid2);
  insert into auth.users (id) values (v_uid3);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid2, v_ws, 'owner');
  v_blocked := false;
  begin insert into workspace_members (user_id, workspace_id, role) values (v_uid3, v_ws, 'agent');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second seat must block on free';

  -- INSTAGRAM (via clientes join): free max_instagram_accounts = 1
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig1');
  v_blocked := false;
  begin insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig2');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second instagram account must block on free';

  raise notice 'PASS 03_workspace_scoped';
end $$;
rollback;
