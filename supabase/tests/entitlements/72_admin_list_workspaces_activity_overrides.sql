\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_plain uuid; v_over uuid; v_old uuid;
  v_uid uuid := gen_random_uuid();
  v jsonb;
  ids uuid[];
begin
  v_plain := et_make_workspace('max');
  update workspaces set name = 'ET act plain' where id = v_plain;
  v_over  := et_make_workspace('max', '{"max_clients": 99}'::jsonb);
  update workspaces set name = 'ET act override' where id = v_over;
  v_old   := et_make_workspace('max');
  update workspaces set name = 'ET act old', created_at = now() - interval '400 days' where id = v_old;

  -- Give v_over one client so it has activity; v_plain and v_old stay never-active.
  insert into auth.users (id, email) values (v_uid, 'et-act@example.com');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_over, 'C', 'C', '#000');

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET act', p_has_overrides := true);
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over,
    format('has_overrides=true: got %s', v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'ET act', p_has_overrides := false);
  assert (v ->> 'total')::int = 2, format('has_overrides=false: expected 2, got %s', v ->> 'total');

  v := admin_list_workspaces(p_search := 'ET act', p_activity := 'nunca');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2 and v_plain = any(ids) and v_old = any(ids),
    format('nunca: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET act', p_activity := '7d');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over, '7d: only the active one';

  v := admin_list_workspaces(p_search := 'ET act', p_activity := 'dormente');
  assert (v ->> 'total')::int = 0, 'dormente: nobody has old activity here';

  -- asc on last_activity_at puts never-active (NULL) rows first.
  v := admin_list_workspaces(p_search := 'ET act', p_sort := 'last_activity_at', p_dir := 'asc');
  assert (v -> 'workspaces' -> 2 ->> 'id')::uuid = v_over,
    'last_activity_at asc must list NULLs first and the active workspace last';
  v := admin_list_workspaces(p_search := 'ET act', p_sort := 'last_activity_at', p_dir := 'desc');
  assert (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over,
    'last_activity_at desc must list the active workspace first';

  v := admin_list_workspaces(p_search := 'ET act', p_created_since := now() - interval '30 days');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2 and not (v_old = any(ids)), format('created_since: got %s', ids);

  execute 'reset role';
  raise notice 'PASS 72_admin_list_workspaces_activity_overrides';
end $$;
rollback;
