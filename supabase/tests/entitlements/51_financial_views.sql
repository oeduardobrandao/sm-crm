\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Masking, tenant isolation and write-denial on membros_v / clientes_v.

begin;
do $$
declare
  v_ws_a  uuid; v_ws_b uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_val   numeric;
  v_rows  bigint;
  v_ok    boolean;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'),
    (v_admin, v_ws_a, 'admin');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin);

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_a, 'Fulano', 'Designer', 'clt', 5000, '');
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_b, 'Outro WS', 'Dev', 'clt', 9999, '');
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_owner, v_ws_a, 'Cliente A', 'CA', '#000', 3000);

  -- authorized admin sees the real values
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal into v_val from public.membros_v where nome = 'Fulano';
  reset role;
  if v_val is distinct from 5000 then
    raise exception 'authorized admin should read custo_mensal=5000, got %', v_val;
  end if;

  -- restricted admin sees NULL, but still sees the ROW
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal, count(*) over () into v_val, v_rows
    from public.membros_v where nome = 'Fulano';
  reset role;
  if v_rows <> 1 then
    raise exception 'restricted admin must still SEE the member row, got % rows', v_rows;
  end if;
  if v_val is not null then
    raise exception 'restricted admin should read custo_mensal=NULL, got %', v_val;
  end if;

  -- clientes_v masks the same way
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor_mensal into v_val from public.clientes_v where nome = 'Cliente A';
  reset role;
  if v_val is not null then
    raise exception 'restricted admin should read valor_mensal=NULL, got %', v_val;
  end if;

  -- tenant isolation: workspace B's member is invisible through the view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v where nome = 'Outro WS';
  reset role;
  if v_rows <> 0 then
    raise exception 'view leaked workspace B rows: % found', v_rows;
  end if;

  -- stale pointer: membership deleted while active_workspace_id still points there
  delete from workspace_members where user_id = v_admin and workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v;
  reset role;
  if v_rows <> 0 then
    raise exception 'stale active_workspace_id must yield 0 rows, got %', v_rows;
  end if;

  -- writes through the view are denied for authenticated
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into public.membros_v (nome, cargo, tipo, conta_id, avatar_url)
      values ('Injetado', 'X', 'clt', v_ws_b, '');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'INSERT through membros_v must be denied for authenticated';
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    update public.membros_v set conta_id = v_ws_b where nome = 'Fulano';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'UPDATE through membros_v must be denied for authenticated';
  end if;

  raise notice '51_financial_views: all view cases passed';
end $$;
rollback;
