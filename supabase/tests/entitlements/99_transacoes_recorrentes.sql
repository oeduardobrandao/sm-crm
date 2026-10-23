\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Lançamentos recorrentes (20261029000001_transacoes_recorrentes.sql): same access as
-- transacoes. Owner reads and writes its own workspace; another workspace sees nothing;
-- "financeiro: ver" reads but cannot write; no financeiro permission reads nothing; a plan
-- without feature_financial cannot insert; the CHECKs reject bad days and months.

begin;
select et_grant_hosted_parity(array['transacoes_recorrentes']);

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
-- rows of transacoes_recorrentes p_user can select
create or replace function pg_temp.vistos(p_user uuid) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v from public.transacoes_recorrentes;
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
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  v_a uuid; v_b uuid; v_free uuid;
  v_dono_a uuid; v_dono_b uuid; v_dono_free uuid; v_ver_a uuid; v_sem_a uuid;
  v_ins constant text := 'insert into public.transacoes_recorrentes (conta_id, user_id, tipo, descricao, categoria, valor, dia, inicio) values (%L, %L, ''saida'', %L, ''Ferramenta'', %s, %s, %L)';
  v_e text;
  v_id bigint;
begin
  v_a := et_make_workspace('max');
  v_b := et_make_workspace('max');
  v_free := et_make_workspace('free');
  v_dono_a := pg_temp.usuario(v_a, 'owner');
  v_dono_b := pg_temp.usuario(v_b, 'owner');
  v_dono_free := pg_temp.usuario(v_free, 'owner');
  v_ver_a := pg_temp.usuario(v_a, 'agent', '{"financeiro":"ver"}'::jsonb);
  v_sem_a := pg_temp.usuario(v_a, 'agent', '{}'::jsonb);

  -- owner_reads_and_writes_own
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a, v_dono_a, 'Canva', 99.9, 10, '2026-10-01'));
  assert v_e is null, 'owner insert: ' || coalesce(v_e, '');
  assert pg_temp.vistos(v_dono_a) = 1, 'owner sees its row';
  select id into v_id from public.transacoes_recorrentes where conta_id = v_a;
  assert pg_temp.afetadas(v_dono_a, format('update public.transacoes_recorrentes set valor = 120 where id = %s', v_id)) = 1,
    'owner updates';
  raise notice 'PASS owner_reads_and_writes_own';

  -- other_workspace_isolated
  assert pg_temp.vistos(v_dono_b) = 0, 'other workspace sees nothing';
  v_e := pg_temp.erro(v_dono_b, format(v_ins, v_a, v_dono_b, 'Intruso', 10, 5, '2026-10-01'));
  assert v_e like '42501:%', 'insert into another workspace denied: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(v_dono_b, format('update public.transacoes_recorrentes set valor = 1 where id = %s', v_id)) = 0,
    'other workspace updates nothing';
  assert pg_temp.afetadas(v_dono_b, format('delete from public.transacoes_recorrentes where id = %s', v_id)) = 0,
    'other workspace deletes nothing';
  raise notice 'PASS other_workspace_isolated';

  -- ver_reads_but_cannot_write
  assert pg_temp.vistos(v_ver_a) = 1, 'financeiro:ver reads';
  v_e := pg_temp.erro(v_ver_a, format(v_ins, v_a, v_ver_a, 'Ver', 10, 5, '2026-10-01'));
  assert v_e like '42501:%', 'financeiro:ver insert denied: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(v_ver_a, format('update public.transacoes_recorrentes set valor = 1 where id = %s', v_id)) = 0,
    'financeiro:ver updates nothing';
  assert pg_temp.afetadas(v_ver_a, format('delete from public.transacoes_recorrentes where id = %s', v_id)) = 0,
    'financeiro:ver deletes nothing';
  raise notice 'PASS ver_reads_but_cannot_write';

  -- no_financials_sees_nothing
  assert pg_temp.vistos(v_sem_a) = 0, 'no financeiro permission reads nothing';
  raise notice 'PASS no_financials_sees_nothing';

  -- plan_without_financial_denied
  v_e := pg_temp.erro(v_dono_free, format(v_ins, v_free, v_dono_free, 'Free', 10, 5, '2026-10-01'));
  assert v_e is not null, 'free plan insert denied';
  raise notice 'PASS plan_without_financial_denied';

  -- checks_reject_bad_values
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a, v_dono_a, 'Dia 32', 10, 32, '2026-10-01'));
  assert v_e like '23514:%', 'dia 32 rejected: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a, v_dono_a, 'Meio do mês', 10, 5, '2026-10-15'));
  assert v_e like '23514:%', 'inicio not on the 1st rejected: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(v_dono_a, format(v_ins, v_a, v_dono_a, 'Zero', 0, 5, '2026-10-01'));
  assert v_e like '23514:%', 'valor 0 rejected: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(v_dono_a, format('update public.transacoes_recorrentes set fim = ''2026-09-01'' where id = %s', v_id)) = -1,
    'fim before inicio rejected';
  assert pg_temp.afetadas(v_dono_a, format('update public.transacoes_recorrentes set fim = ''2026-12-01'' where id = %s', v_id)) = 1,
    'fim on a later month accepted';
  raise notice 'PASS checks_reject_bad_values';

  -- owner_deletes
  assert pg_temp.afetadas(v_dono_a, format('delete from public.transacoes_recorrentes where id = %s', v_id)) = 1,
    'owner deletes';
  raise notice 'PASS owner_deletes';

  -- grants: anon has nothing
  assert not has_table_privilege('anon', 'public.transacoes_recorrentes', 'SELECT'), 'anon cannot select';
  raise notice 'PASS anon_has_no_grant';
end $$;

rollback;
