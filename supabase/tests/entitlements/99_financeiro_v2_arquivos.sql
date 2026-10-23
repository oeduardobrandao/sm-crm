\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 private bucket for signed team-agreement contracts
-- (20261027000007_financeiro_v2_arquivos.sql). Path: <conta_id>/<membro_id>/<uuid>.<ext>.
-- SELECT needs can_see_financials(), INSERT needs has_permission('financeiro','editar'),
-- both behind feature_financial + feature_financeiro_v2 and the caller's own conta_id
-- as first segment; the second segment must be a membros.id of that workspace. There is
-- no UPDATE or DELETE policy at all (a replaced contract is a new object).
-- The storage.objects inserts only fill bucket_id/name (+ owner-less); every other
-- column is nullable or defaulted in Supabase's storage schema.
begin;
-- The avatars policies on storage.objects read workspace_members directly, and every
-- permissive policy is evaluated on an insert; hosted grants that table to
-- authenticated, a fresh local/CI stack does not.
select et_grant_hosted_parity();

-- 'SQLSTATE:message' of the error p_sql raises as p_user (authenticated), or NULL on success
create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- number of financeiro-acordos objects p_user (authenticated) can select
create or replace function pg_temp.vistos(p_user uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from storage.objects where bucket_id = 'financeiro-acordos';
  execute 'reset role';
  return v;
end $f$;
-- rows affected by p_sql (an UPDATE or DELETE) as p_user; -1 when it raised
create or replace function pg_temp.afetadas(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics v = row_count;
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  return -1;
end $f$;
create or replace function pg_temp.novo_ws(p_flag boolean) returns uuid language plpgsql as $f$
declare v_ws uuid;
begin
  v_ws := et_make_workspace('max');
  if p_flag then
    insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_financeiro_v2": true}'::jsonb);
  end if;
  return v_ws;
end $f$;
create or replace function pg_temp.usuario(p_ws uuid, p_role text, p_perm jsonb default null) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid(); v_role uuid;
begin
  insert into auth.users (id) values (v_u);
  if p_perm is null then
    insert into workspace_members (user_id, workspace_id, role) values (v_u, p_ws, p_role);
  else
    insert into workspace_roles (conta_id, nome, permissions) values (p_ws, 'r-' || v_u, p_perm) returning id into v_role;
    insert into workspace_members (user_id, workspace_id, role, role_id) values (v_u, p_ws, 'agent', v_role);
  end if;
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;
create or replace function pg_temp.membro(p_ws uuid, p_user uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (p_user, p_ws, 'Membro', 'Design', 'clt', 1000, '') returning id into v;
  return v;
end $f$;
-- the bucket row alone: object inserts as postgres bypass RLS (fixtures)
create or replace function pg_temp.objeto(p_name text) returns void language sql as $f$
  insert into storage.objects (bucket_id, name) values ('financeiro-acordos', p_name);
$f$;
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_dono_a uuid; v_dono_b uuid; v_dono_c uuid; v_ver_a uuid; v_sem_a uuid;
  v_mem_a bigint; v_mem_b bigint; v_mem_c bigint;
  v_ins constant text := 'insert into storage.objects (bucket_id, name) values (''financeiro-acordos'', %L)';
  v_e text;
  v_n bigint;
begin
  v_a := pg_temp.novo_ws(true);
  v_b := pg_temp.novo_ws(true);
  v_c := pg_temp.novo_ws(false);
  v_dono_a := pg_temp.usuario(v_a, 'owner');
  v_dono_b := pg_temp.usuario(v_b, 'owner');
  v_dono_c := pg_temp.usuario(v_c, 'owner');
  v_ver_a := pg_temp.usuario(v_a, 'agent', '{"financeiro":"ver"}'::jsonb);
  v_sem_a := pg_temp.usuario(v_a, 'agent', '{}'::jsonb);
  v_mem_a := pg_temp.membro(v_a, v_dono_a);
  v_mem_b := pg_temp.membro(v_b, v_dono_b);
  v_mem_c := pg_temp.membro(v_c, v_dono_c);

  -- bucket config: first private bucket in the repo
  assert exists (select 1 from storage.buckets
                  where id = 'financeiro-acordos' and name = 'financeiro-acordos' and public = false
                    and file_size_limit = 10485760
                    and allowed_mime_types = '{application/pdf,image/png,image/jpeg}'),
    'bucket financeiro-acordos missing or misconfigured';

  -- ---- owner_can_insert_and_read_own_prefix ----
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf'));
  assert v_e is null, 'owner_can_insert_and_read_own_prefix: insert denied: ' || coalesce(v_e, '');
  assert pg_temp.vistos(v_dono_a) = 1, 'owner_can_insert_and_read_own_prefix: owner cannot read own object';
  assert pg_temp.vistos(v_ver_a) = 1, 'owner_can_insert_and_read_own_prefix: financeiro:ver cannot read';
  raise notice 'PASS owner_can_insert_and_read_own_prefix';

  -- ---- other_workspace_prefix_denied ----
  assert pg_temp.vistos(v_dono_b) = 0, 'other_workspace_prefix_denied: workspace B reads A''s object';
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_b || '/' || v_mem_b || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'other_workspace_prefix_denied: write into B''s prefix was not an RLS denial: ' || coalesce(v_e, 'NULL');
  -- right workspace, but a membro of another workspace
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a || '/' || v_mem_b || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'foreign membro id was not an RLS denial: ' || coalesce(v_e, 'NULL');
  -- the mirror: B's prefix with A's membro is denied from either workspace, on write and read
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_b || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'mirror path written from A was not an RLS denial: ' || coalesce(v_e, 'NULL');
  v_e := pg_temp.erro(v_dono_b, format(v_ins, v_b || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'mirror path written from B was not an RLS denial: ' || coalesce(v_e, 'NULL');
  perform pg_temp.objeto(v_b || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf');
  assert pg_temp.vistos(v_dono_a) = 1, 'mirror object readable from A';
  assert pg_temp.vistos(v_dono_b) = 0, 'mirror object readable from B';
  -- a non-uuid first segment is denied, not a cast error
  v_e := pg_temp.erro(v_dono_a, format(v_ins, 'not-a-uuid/' || v_mem_a || '/x.pdf'));
  assert v_e like '42501:%', 'non-uuid prefix must be an RLS denial, got: ' || coalesce(v_e, 'NULL');
  -- non-numeric / missing / absent membro segments are denied too
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a || '/abc/x.pdf'));
  assert v_e like '42501:%', 'non-numeric membro segment must be an RLS denial, got: ' || coalesce(v_e, 'NULL');
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a || '/x.pdf'));
  assert v_e like '42501:%', 'path without membro segment must be an RLS denial, got: ' || coalesce(v_e, 'NULL');
  v_e := pg_temp.erro(v_dono_a, format(v_ins, 'x.pdf'));
  assert v_e like '42501:%', 'path without folders must be an RLS denial, got: ' || coalesce(v_e, 'NULL');
  -- another bucket is not governed by these policies
  v_e := pg_temp.erro(v_dono_a, format('insert into storage.objects (bucket_id, name) values (''outro-bucket'', %L)', v_a || '/' || v_mem_a || '/x.pdf'));
  assert v_e is not null, 'insert into an unrelated bucket must not pass these policies';
  raise notice 'PASS other_workspace_prefix_denied';

  -- ---- no_financials_read_denied ----
  assert pg_temp.vistos(v_sem_a) = 0, 'no_financials_read_denied: member without financeiro reads the object';
  v_e := pg_temp.erro(v_sem_a, format(v_ins, v_a || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'no_financials_read_denied: write by member without financeiro: ' || coalesce(v_e, 'NULL');
  -- ver can read but not write
  v_e := pg_temp.erro(v_ver_a, format(v_ins, v_a || '/' || v_mem_a || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'financeiro:ver must not insert, got: ' || coalesce(v_e, 'NULL');
  raise notice 'PASS no_financials_read_denied';

  -- ---- flag_off_denied ----
  perform pg_temp.objeto(v_c || '/' || v_mem_c || '/' || gen_random_uuid() || '.pdf');
  assert pg_temp.vistos(v_dono_c) = 0, 'flag_off_denied: owner reads with feature_financeiro_v2 off';
  v_e := pg_temp.erro(v_dono_c, format(v_ins, v_c || '/' || v_mem_c || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'flag_off_denied: owner inserts with the flag off: ' || coalesce(v_e, 'NULL');
  -- feature_financial off on a flag-on workspace
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_c, '{"feature_financeiro_v2": true, "feature_financial": false}'::jsonb)
    on conflict (workspace_id) do update set feature_overrides = excluded.feature_overrides;
  assert pg_temp.vistos(v_dono_c) = 0, 'flag_off_denied: owner reads with feature_financial off';
  v_e := pg_temp.erro(v_dono_c, format(v_ins, v_c || '/' || v_mem_c || '/' || gen_random_uuid() || '.pdf'));
  assert v_e like '42501:%', 'flag_off_denied: owner inserts with feature_financial off: ' || coalesce(v_e, 'NULL');
  raise notice 'PASS flag_off_denied';

  -- ---- no UPDATE / DELETE policy ----
  v_n := pg_temp.afetadas(v_dono_a, 'update storage.objects set name = name || ''x'' where bucket_id = ''financeiro-acordos''');
  assert v_n = 0, 'update_delete_denied: authenticated UPDATE affected ' || v_n || ' rows';
  -- Supabase's storage.protect_delete trigger raises on a direct DELETE before RLS is
  -- consulted (afetadas = -1); a stack without it yields 0 rows. Either way nothing goes.
  v_n := pg_temp.afetadas(v_dono_a, 'delete from storage.objects where bucket_id = ''financeiro-acordos''');
  assert v_n <= 0, 'update_delete_denied: authenticated DELETE affected ' || v_n || ' rows';
  assert (select count(*) from storage.objects where bucket_id = 'financeiro-acordos' and v_a::text = split_part(name, '/', 1)) = 1,
    'update_delete_denied: the owner''s object changed or vanished';
  assert not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                        and policyname like 'financeiro_acordos_%' and cmd in ('UPDATE', 'DELETE', 'ALL')),
    'update_delete_denied: an UPDATE/DELETE/ALL policy exists';
  raise notice 'PASS update_delete_denied';
end $$;
rollback;
