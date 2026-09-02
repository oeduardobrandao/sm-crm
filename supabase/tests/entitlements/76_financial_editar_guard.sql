\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- guard_financial_write()'s post-Migração-B condition
-- (20260904000001_workspace_roles_b_enforcement.sql, item (2)): the trigger
-- guarding membros.custo_mensal / clientes.valor_mensal now requires
-- has_permission('financeiro','editar'), not can_see_financials() (which is
-- itself now just financeiro/ver). Custom-role fixture technique from
-- 72_workspace_roles_permissions.sql; write-guard exercise technique (seed as
-- postgres, mutate as authenticated, assert P0001/financial_access_denied)
-- from 52_financial_enforcement.sql section 5 -- that suite covers the
-- legacy-role truth table exhaustively and stays unedited as the
-- compatibility proof; this one adds the papel cases plus a direct regression
-- of 52's admin-flag=false case against the NEW guard body.

-- =============================================================
-- FG-01: papel {"financeiro":"ver"} -- UPDATE de clientes.valor_mensal
-- levanta financial_access_denied; UPDATE de um campo não-financeiro passa
-- (o guard só intercepta a coluna vigiada, TG_ARGV[0]).
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws       uuid;
  v_c_ver    uuid := gen_random_uuid();
  v_role_ver uuid;
  v_cid      bigint;
  v_val      numeric;
  v_nome     text;
  v_rows     bigint;
  v_ok       boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_c_ver);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'FG-01 financeiro ver', '{"financeiro":"ver"}'::jsonb) returning id into v_role_ver;
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_ver, v_ws, 'agent', v_role_ver);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_c_ver;

  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_c_ver, v_ws, 'FG01Cliente', 'FG', '#000', 1000) returning id into v_cid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_ver, 'role', 'authenticated')::text, true);

  -- UPDATE valor_mensal: financial_access_denied.
  v_ok := false;
  set local role authenticated;
  begin
    update clientes set valor_mensal = 2000 where id = v_cid;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'financial_access_denied' then raise; end if;
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'FG-01: financeiro:ver UPDATE of valor_mensal must be denied';
  end if;
  select valor_mensal into v_val from clientes where id = v_cid;
  if v_val is distinct from 1000 then
    raise exception 'FG-01: denied update must not have mutated valor_mensal, got %', v_val;
  end if;

  -- UPDATE de campo não-financeiro passa.
  set local role authenticated;
  update clientes set nome = 'FG01Renamed' where id = v_cid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'FG-01: non-financial UPDATE must affect 1 row, affected %', v_rows;
  end if;
  select nome into v_nome from clientes where id = v_cid;
  if v_nome is distinct from 'FG01Renamed' then
    raise exception 'FG-01: non-financial UPDATE did not take effect, got %', v_nome;
  end if;

  raise notice 'FG-01: ok';
end $$;
rollback;

-- =============================================================
-- FG-02: papel {"financeiro":"editar"} -- UPDATE de clientes.valor_mensal E
-- de membros.custo_mensal, ambos ok (a mesma guard function serve as duas
-- colunas via TG_ARGV[0]).
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws          uuid;
  v_c_editar    uuid := gen_random_uuid();
  v_role_editar uuid;
  v_cid         bigint;
  v_mid         bigint;
  v_val         numeric;
  v_rows        bigint;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_c_editar);

  insert into workspace_roles (conta_id, nome, permissions) values
    (v_ws, 'FG-02 financeiro editar', '{"financeiro":"editar"}'::jsonb) returning id into v_role_editar;
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_c_editar, v_ws, 'agent', v_role_editar);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_c_editar;

  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_c_editar, v_ws, 'FG02Cliente', 'FG', '#000', 1000) returning id into v_cid;
  insert into membros (user_id, conta_id, nome, cargo, tipo, avatar_url, custo_mensal)
    values (v_c_editar, v_ws, 'FG02Membro', 'X', 'clt', '', 500) returning id into v_mid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c_editar, 'role', 'authenticated')::text, true);

  set local role authenticated;
  update clientes set valor_mensal = 2000 where id = v_cid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'FG-02: financeiro:editar UPDATE of clientes.valor_mensal must succeed, affected %', v_rows;
  end if;
  select valor_mensal into v_val from clientes where id = v_cid;
  if v_val is distinct from 2000 then
    raise exception 'FG-02: valor_mensal update did not take effect, got %', v_val;
  end if;

  set local role authenticated;
  update membros set custo_mensal = 900 where id = v_mid;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'FG-02: financeiro:editar UPDATE of membros.custo_mensal must succeed, affected %', v_rows;
  end if;
  select custo_mensal into v_val from membros where id = v_mid;
  if v_val is distinct from 900 then
    raise exception 'FG-02: custo_mensal update did not take effect, got %', v_val;
  end if;

  raise notice 'FG-02: ok';
end $$;
rollback;

-- =============================================================
-- FG-03: admin legado -- can_see_financials=true muda valor_mensal ok;
-- can_see_financials=false negado (regressão do 52, reprovada aqui contra o
-- corpo NOVO do guard -- has_permission('financeiro','editar') colapsa para
-- o mesmo flag no fallback legado, não só contra o corpo antigo em 52).
-- =============================================================
begin;
select et_grant_hosted_parity(ARRAY['membros', 'clientes']);
grant insert, update, delete on public.membros, public.clientes to anon, authenticated;
do $$
declare
  v_ws       uuid;
  v_admin_ok uuid := gen_random_uuid();
  v_admin_no uuid := gen_random_uuid();
  v_cid_ok   bigint;
  v_cid_no   bigint;
  v_val      numeric;
  v_rows     bigint;
  v_ok       boolean;
begin
  v_ws := et_make_workspace('max');
  insert into auth.users (id) values (v_admin_ok), (v_admin_no);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_admin_ok, v_ws, 'admin'), (v_admin_no, v_ws, 'admin');
  update workspace_members set can_see_financials = false
   where user_id = v_admin_no and workspace_id = v_ws;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_admin_ok, v_admin_no);

  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_admin_ok, v_ws, 'FG03Ok', 'FG', '#000', 1000) returning id into v_cid_ok;
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_admin_no, v_ws, 'FG03No', 'FG', '#000', 1000) returning id into v_cid_no;

  -- can_see_financials=true: UPDATE ok.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_ok, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update clientes set valor_mensal = 3000 where id = v_cid_ok;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 1 then
    raise exception 'FG-03: authorized legacy admin UPDATE must succeed, affected %', v_rows;
  end if;
  select valor_mensal into v_val from clientes where id = v_cid_ok;
  if v_val is distinct from 3000 then
    raise exception 'FG-03: authorized legacy admin update did not take effect, got %', v_val;
  end if;

  -- can_see_financials=false: negado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_no, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    update clientes set valor_mensal = 3000 where id = v_cid_no;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'financial_access_denied' then raise; end if;
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'FG-03: restricted legacy admin UPDATE must be denied (regression of 52)';
  end if;
  select valor_mensal into v_val from clientes where id = v_cid_no;
  if v_val is distinct from 1000 then
    raise exception 'FG-03: denied update must not have mutated valor_mensal, got %', v_val;
  end if;

  raise notice 'FG-03: ok';
end $$;
rollback;
