\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, ajustes da revisão final
-- (20261115000012_acesso_por_cliente_h_ajustes.sql).
-- audit_log: owner_admin_select também exige my_client_scope_all(). O log
-- guarda nome e sigla de todo cliente criado (e eventos de post), então um
-- admin restrito não lê nada dele; dono e admin 'todos' seguem iguais.
-- workspace_usage(): para o restrito, clientes, contas do Instagram e links do
-- Hub contam só os clientes dele; dono e 'todos' recebem o mesmo jsonb de antes.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

begin;
select et_grant_hosted_parity(array['clientes', 'membros', 'notifications', 'analytics_reports', 'workspace_member_clientes']);

create temp table _fx (k text primary key, v text not null);
create or replace function pg_temp.fx(p_k text) returns text language sql as $f$
  select v from _fx where k = p_k;
$f$;
-- count(*) of a query as p_user (authenticated)
create or replace function pg_temp.n_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- a jsonb expression as p_user (authenticated)
create or replace function pg_temp.j_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;
grant select on _fx to authenticated;

-- =============================================================
-- block 1: fixtures
-- =============================================================
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();    -- admin, 'todos'
  v_radm uuid := gen_random_uuid();   -- admin, restricted to A
  v_restr uuid := gen_random_uuid();  -- agent, restricted to A
  v_ca bigint; v_cb bigint;
begin
  insert into auth.users (id, email) values
    (v_owner, 'owner@acaj.test'), (v_adm, 'adm@acaj.test'), (v_radm, 'radm@acaj.test'), (v_restr, 'restr@acaj.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_adm, v_ws, 'admin'), (v_radm, v_ws, 'admin'), (v_restr, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_adm, v_radm, v_restr);
  -- audit_log's policy reads the legacy profiles.role
  update profiles set role = 'owner' where id = v_owner;
  update profiles set role = 'admin' where id in (v_adm, v_radm);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- audit_client_create writes one 'client-create' row per client
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'ZZB oculto', 'ZB', '#222', 'ativo') returning id into v_cb;
  insert into instagram_accounts (client_id, instagram_user_id, username) values (v_ca, 'ig-a', 'iga'), (v_cb, 'ig-b', 'igb');
  insert into client_hub_tokens (cliente_id, conta_id) values (v_ca, v_ws), (v_cb, v_ws);
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id in (v_radm, v_restr);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws, v_radm, v_ca), (v_ws, v_restr, v_ca);
  perform set_config('request.jwt.claims', '', true);

  insert into _fx values ('ws', v_ws), ('owner', v_owner), ('adm', v_adm), ('radm', v_radm), ('restr', v_restr),
    ('ca', v_ca), ('cb', v_cb);
end $$;

-- =============================================================
-- block 2: audit_log
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_cb bigint := pg_temp.fx('cb');
  v_all bigint; v_n bigint;
begin
  select count(*) into v_all from audit_log where conta_id = v_ws;
  assert v_all >= 2, 'fixture: client-create rows written: ' || v_all;

  -- restricted_admin_reads_no_audit_of_hidden_client (final review repro)
  v_n := pg_temp.n_as(pg_temp.fx('radm')::uuid, format(
    $q$select count(*) from audit_log where action = 'client-create' and resource_id = %L$q$, v_cb));
  assert v_n = 0, 'restricted_admin_reads_no_audit_of_hidden_client: ' || v_n;
  v_n := pg_temp.n_as(pg_temp.fx('radm')::uuid, 'select count(*) from audit_log');
  assert v_n = 0, 'restricted_admin_reads_no_audit: ' || v_n;
  v_n := pg_temp.n_as(pg_temp.fx('restr')::uuid, 'select count(*) from audit_log');
  assert v_n = 0, 'restricted_agent_reads_no_audit: ' || v_n;

  -- owner / 'todos' admin unchanged: the whole workspace log
  v_n := pg_temp.n_as(pg_temp.fx('owner')::uuid, format('select count(*) from audit_log where conta_id = %L', v_ws));
  assert v_n = v_all, format('owner_reads_all_audit: %s of %s', v_n, v_all);
  v_n := pg_temp.n_as(pg_temp.fx('adm')::uuid, format('select count(*) from audit_log where conta_id = %L', v_ws));
  assert v_n = v_all, format('todos_admin_reads_all_audit: %s of %s', v_n, v_all);

  assert (select qual from pg_policies where schemaname = 'public' and tablename = 'audit_log'
            and policyname = 'owner_admin_select') ~ '\mmy_client_scope_all\M',
    'audit_log owner_admin_select cites my_client_scope_all';
  raise notice 'PASS block 2 audit_log';
end $$;

-- =============================================================
-- block 3: workspace_usage
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_expected jsonb;
  v_j jsonb;
begin
  -- the pre-change body, computed as superuser
  v_expected := jsonb_build_object(
    'clients',            (select count(*) from clientes where conta_id = v_ws),
    'team_members',       (select count(*) from workspace_members where workspace_id = v_ws),
    'pending_invites',    (select count(*) from invites where conta_id = v_ws and status = 'pending'),
    'leads',              (select count(*) from leads where conta_id = v_ws),
    'hub_tokens',         (select count(*) from client_hub_tokens where conta_id = v_ws),
    'workflow_templates', (select count(*) from workflow_templates where conta_id = v_ws),
    'instagram_accounts', (select count(*) from instagram_accounts t join clientes c on c.id = t.client_id where c.conta_id = v_ws),
    'mcp_keys',           (select count(*) from mcp_api_keys where conta_id = v_ws and revoked_at is null),
    'storage_used_bytes', (select coalesce(storage_used_bytes, 0) from workspaces where id = v_ws));
  assert (v_expected->>'clients')::int = 2 and (v_expected->>'instagram_accounts')::int = 2
     and (v_expected->>'hub_tokens')::int = 2, 'fixture usage: ' || v_expected::text;

  -- owner / 'todos': unchanged
  v_j := pg_temp.j_as(pg_temp.fx('owner')::uuid, 'select workspace_usage()');
  assert v_j = v_expected, format('owner_usage_unchanged: %s vs %s', v_j, v_expected);
  v_j := pg_temp.j_as(pg_temp.fx('adm')::uuid, 'select workspace_usage()');
  assert v_j = v_expected, format('todos_usage_unchanged: %s vs %s', v_j, v_expected);

  -- restricted: only his clients (A) behind the client-bound counters
  v_j := pg_temp.j_as(pg_temp.fx('restr')::uuid, 'select workspace_usage()');
  assert v_j = v_expected || '{"clients": 1, "instagram_accounts": 1, "hub_tokens": 1}'::jsonb,
    'restricted_usage_counts_own_clients: ' || v_j::text;
  v_j := pg_temp.j_as(pg_temp.fx('radm')::uuid, 'select workspace_usage()');
  assert v_j = v_expected || '{"clients": 1, "instagram_accounts": 1, "hub_tokens": 1}'::jsonb,
    'restricted_admin_usage_counts_own_clients: ' || v_j::text;
  raise notice 'PASS block 3 workspace_usage';
end $$;

-- =============================================================
-- block 4: owner / 'todos' pay no per-row scope call
-- =============================================================
set local track_functions = 'all';
do $$
declare c0 bigint; c1 bigint; c2 bigint;
begin
  select coalesce(sum(calls), 0) into c0 from pg_stat_xact_user_functions where funcname = 'can_access_cliente';
  perform pg_temp.j_as(pg_temp.fx('owner')::uuid, 'select workspace_usage()');
  perform pg_temp.j_as(pg_temp.fx('adm')::uuid, 'select workspace_usage()');
  perform pg_temp.n_as(pg_temp.fx('adm')::uuid, 'select count(*) from audit_log');
  select coalesce(sum(calls), 0) into c1 from pg_stat_xact_user_functions where funcname = 'can_access_cliente';
  assert c1 = c0, format('todos_owner_zero_scope_calls: %s -> %s', c0, c1);
  perform pg_temp.j_as(pg_temp.fx('restr')::uuid, 'select workspace_usage()');
  select coalesce(sum(calls), 0) into c2 from pg_stat_xact_user_functions where funcname = 'can_access_cliente';
  assert c2 > c1, 'sanity: the restricted path calls can_access_cliente: ' || c2;
  raise notice 'PASS block 4 zero scope calls';
end $$;

rollback;
\echo 99_acesso_por_cliente_ajustes: ok
