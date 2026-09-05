\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_uid uuid := gen_random_uuid();
  v jsonb; v_p0 jsonb; v_p1 jsonb;
  ids uuid[];
begin
  -- Names deliberately out of creation order; client counts 0 / 2 / 5.
  v_a := et_make_workspace('max'); update workspaces set name = 'ET sort Zeta',  created_at = now() - interval '3 days' where id = v_a;
  v_b := et_make_workspace('max'); update workspaces set name = 'ET sort Alpha', created_at = now() - interval '2 days' where id = v_b;
  v_c := et_make_workspace('max'); update workspaces set name = 'ET sort Mid',   created_at = now() - interval '1 day'  where id = v_c;

  insert into auth.users (id, email) values (v_uid, 'et-sort@example.com');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    select v_uid, v_b, 'C', 'C', '#000' from generate_series(1, 2);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    select v_uid, v_c, 'C', 'C', '#000' from generate_series(1, 5);

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'client_count', p_dir := 'desc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_c, v_b, v_a], format('client_count desc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'client_count', p_dir := 'asc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_a, v_b, v_c], format('client_count asc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'name', p_dir := 'asc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_b, v_c, v_a], format('name asc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'name', p_dir := 'desc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_a, v_c, v_b], format('name desc: got %s', ids);

  -- Unknown sort key falls back to created_at desc (newest first).
  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'garbage', p_dir := 'sideways');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_c, v_b, v_a], format('fallback sort: got %s', ids);
  assert (v ->> 'total')::int = 3, 'sorting must not change total';

  -- Pagination through row_number: no overlap, no gaps.
  v_p0 := admin_list_workspaces(p_search := 'ET sort', p_offset := 0, p_limit := 2, p_sort := 'name', p_dir := 'asc');
  v_p1 := admin_list_workspaces(p_search := 'ET sort', p_offset := 2, p_limit := 2, p_sort := 'name', p_dir := 'asc');
  assert jsonb_array_length(v_p0 -> 'workspaces') = 2 and jsonb_array_length(v_p1 -> 'workspaces') = 1,
    'pages must hold 2 + 1 rows';
  assert (v_p1 -> 'workspaces' -> 0 ->> 'id')::uuid = v_a, 'last page must hold the last-sorted row';
  assert (v_p0 ->> 'total')::int = 3 and (v_p1 ->> 'total')::int = 3, 'total is page-independent';

  execute 'reset role';
  raise notice 'PASS 71_admin_list_workspaces_sort';
end $$;
rollback;
