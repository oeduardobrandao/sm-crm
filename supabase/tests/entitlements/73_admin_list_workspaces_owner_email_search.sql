\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_other uuid;
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_owner_auto_ws uuid;
  v_member_auto_ws uuid;
  v jsonb;
begin
  v_ws    := et_make_workspace('max'); update workspaces set name = 'ET mail one' where id = v_ws;
  v_other := et_make_workspace('max'); update workspaces set name = 'ET mail two' where id = v_other;

  -- handle_new_user_workspace fires on every auth.users insert and auto-creates a "Meu
  -- Workspace" (profile + workspace_members owner row) for the new user, since neither
  -- insert carries a conta_id invite in raw_user_meta_data. Capture those auto-created
  -- workspace ids before repointing the profiles below, then delete them (cascades to
  -- their workspace_members rows) so they don't also match the owner-email search --
  -- otherwise dona-unica-xyz@example.com would own two workspaces instead of one.
  insert into auth.users (id, email) values
    (v_owner,  'dona-unica-xyz@example.com'),
    (v_member, 'agente-unico-xyz@example.com');
  select conta_id into v_owner_auto_ws  from profiles where id = v_owner;
  select conta_id into v_member_auto_ws from profiles where id = v_member;

  insert into workspace_members (user_id, workspace_id, role, joined_at) values
    (v_owner,  v_ws,    'owner', now()),
    (v_member, v_other, 'agent', now());
  update profiles set conta_id = v_ws,    active_workspace_id = v_ws    where id = v_owner;
  update profiles set conta_id = v_other, active_workspace_id = v_other where id = v_member;

  delete from workspaces where id in (v_owner_auto_ws, v_member_auto_ws);

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'dona-unica-xyz');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_ws,
    format('owner e-mail search: got %s', v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'agente-unico-xyz');
  assert (v ->> 'total')::int = 0, 'non-owner member e-mail must not match';

  v := admin_list_workspaces(p_search := 'ET mail');
  assert (v ->> 'total')::int = 2, 'name search still works';

  execute 'reset role';
  raise notice 'PASS 73_admin_list_workspaces_owner_email_search';
end $$;
rollback;
