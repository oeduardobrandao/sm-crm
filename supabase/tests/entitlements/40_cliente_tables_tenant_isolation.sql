\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression test for the cross-workspace leak fixed by
-- 20260727000006_fix_cliente_tables_active_workspace_rls.sql.
--
-- cliente_enderecos / cliente_datas were adopted from production with policies
-- scoping by ANY workspace the caller belongs to rather than the ACTIVE one.
-- Nothing in the client compensates: getClienteEnderecos/getClienteDatas filter
-- only by cliente_id, and getAllClienteDatas() — which feeds CalendarioPage —
-- has no filter at all. A multi-workspace user therefore saw, and could edit,
-- another workspace's client addresses and important dates through ordinary
-- app usage.
--
-- IMPORTANT — this test MUST impersonate the `authenticated` role, not merely
-- set a JWT claim. Sibling tests (e.g. 31_hub_token_rotate_extend) set claims
-- only, which is sufficient for SECURITY DEFINER RPCs reading auth.uid(). It is
-- NOT sufficient for RLS: the test runs as the table owner, who bypasses row
-- security entirely, so a claims-only version of this test would pass even with
-- the policies reverted to the broken form.

begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_seen  bigint;
  v_rows  bigint;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');

  -- The trigger on auth.users creates the profile (and a throwaway workspace);
  -- re-point it rather than inserting. Membership must exist before
  -- active_workspace_id can point anywhere (trg_validate_active_workspace).
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into cliente_datas (cliente_id, conta_id, titulo, data)
    values (v_cli_a, v_ws_a, 'A-date', '2026-01-01'),
           (v_cli_b, v_ws_b, 'B-CONFIDENTIAL', '2026-02-02');
  insert into cliente_enderecos (cliente_id, conta_id, cidade)
    values (v_cli_a, v_ws_a, 'A-city'),
           (v_cli_b, v_ws_b, 'B-CONFIDENTIAL-city');

  -- ---- act as the user: member of BOTH workspaces, ACTIVE is A ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- READ: only the active workspace's rows.
  select count(*) into v_seen from cliente_datas;
  assert v_seen = 1, format('cliente_datas: expected 1 visible row, got %s', v_seen);
  select count(*) into v_seen from cliente_datas where titulo = 'B-CONFIDENTIAL';
  assert v_seen = 0, 'cliente_datas: foreign workspace row is visible — leak reopened';

  select count(*) into v_seen from cliente_enderecos;
  assert v_seen = 1, format('cliente_enderecos: expected 1 visible row, got %s', v_seen);
  select count(*) into v_seen from cliente_enderecos where cidade like 'B-%';
  assert v_seen = 0, 'cliente_enderecos: foreign workspace row is visible — leak reopened';

  -- WRITE: RLS denies by filtering, not by raising, so assert AFFECTED ROWS.
  -- A test that only checked "no exception" would pass against the broken policy.
  update cliente_datas set titulo = 'HACKED' where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_datas: updated %s foreign row(s)', v_rows);

  delete from cliente_enderecos where conta_id = v_ws_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('cliente_enderecos: deleted %s foreign row(s)', v_rows);

  -- Own-workspace writes must still work; a policy that denied everything
  -- would satisfy every assertion above.
  update cliente_datas set titulo = 'A-renamed' where conta_id = v_ws_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('cliente_datas: own-workspace update affected %s rows', v_rows);

  insert into cliente_datas (cliente_id, conta_id, titulo, data)
    values (v_cli_a, v_ws_a, 'A-new', '2026-03-03');

  execute 'reset role';

  -- The foreign rows are untouched, confirming the writes were filtered rather
  -- than silently applied somewhere else.
  select count(*) into v_seen from cliente_datas
   where conta_id = v_ws_b and titulo = 'B-CONFIDENTIAL';
  assert v_seen = 1, 'foreign cliente_datas row was modified';
  select count(*) into v_seen from cliente_enderecos where conta_id = v_ws_b;
  assert v_seen = 1, 'foreign cliente_enderecos row was deleted';

  raise notice 'PASS 40_cliente_tables_tenant_isolation';
end $$;
rollback;
