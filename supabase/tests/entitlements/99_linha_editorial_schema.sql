\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Linha editorial schema (20261031000001_linha_editorial_schema.sql): the four tables, the
-- feature_linha_editorial flag as write authorization, the guard triggers and the
-- column-level grants that keep status, rodada, post_id and convertido_* RPC-only.

begin;
-- The four tables are excluded: the helper would grant ALL on them and undo the
-- column-level grants this suite asserts.
select et_grant_hosted_parity(array['linhas_editoriais','linha_editorial_colunas','linha_editorial_itens','linha_editorial_respostas']);
-- Defensive: 92_reorder_fluxos_board.sql runs et_grant_hosted_parity() outside a transaction,
-- so its GRANT ALL on every table persists into later suites. Re-apply the migration's grants
-- so a leaked table-level grant cannot mask a column-level one (same reason as 97_crisp_sessions).
revoke all on table public.linhas_editoriais, public.linha_editorial_colunas,
  public.linha_editorial_itens, public.linha_editorial_respostas from public, anon, authenticated;
grant select on table public.linhas_editoriais, public.linha_editorial_colunas,
  public.linha_editorial_itens, public.linha_editorial_respostas to authenticated;
grant update (updated_at) on public.linhas_editoriais to authenticated;
grant insert (conta_id, nome, tipo, config, visivel_cliente, oculta, ordem),
  update (nome, tipo, config, visivel_cliente, oculta, ordem), delete
  on public.linha_editorial_colunas to authenticated;
grant insert (id, linha_id, conta_id, data, tipo, titulo, direcao, valores, ordem),
  update (data, tipo, titulo, direcao, valores, ordem), delete
  on public.linha_editorial_itens to authenticated;
grant insert (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id)
  on public.linha_editorial_respostas to authenticated;

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
-- same, as service_role (bypasses RLS, holds ALL)
create or replace function pg_temp.erro_sr(p_sql text) returns text language plpgsql as $f$
begin
  execute 'set local role service_role';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- rows of p_table p_user can select
create or replace function pg_temp.vistos(p_user uuid, p_table text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.%I', p_table) into v;
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
create or replace function pg_temp.usuario(p_ws uuid) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role) values (v_u, p_ws, 'owner');
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_a uuid; v_b uuid; u_a uuid; u_b uuid;
  v_cli_a bigint; v_cli_b bigint; v_wf bigint; v_post bigint;
  v_linha uuid; v_linha2 uuid; v_linha_cap uuid;
  v_col uuid; v_item uuid; v_item2 uuid; v_item_del uuid; v_resp uuid;
  v_e text; v_n bigint; v_t text; v_r int;
  v_tables constant text[] := array['linhas_editoriais','linha_editorial_colunas','linha_editorial_itens','linha_editorial_respostas'];
  v_ins_item constant text := 'insert into public.linha_editorial_itens (linha_id, conta_id, data, tipo, titulo, ordem) values (%L, %L, %L, ''feed'', %L, %s)';
  v_ins_resp constant text := 'insert into public.linha_editorial_respostas (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id) values (%L, %L, %L, %L, ''oi'', %L, %L)';
begin
  -- ---------- fixture ----------
  v_a := et_make_workspace('max');
  v_b := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_a, '{"feature_linha_editorial": true}');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_b, '{"feature_linha_editorial": true}');
  u_a := pg_temp.usuario(v_a);
  u_b := pg_temp.usuario(v_b);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_a, v_a, 'Cli A', 'CA', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_b, v_b, 'Cli B', 'CB', '#000') returning id into v_cli_b;

  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_linha_editorial'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_linha_editorial is not boolean NOT NULL DEFAULT false';

  -- linhas are created only by the RPC (Task 2); here as the owner role
  insert into linhas_editoriais (conta_id, cliente_id, periodo, created_by)
    values (v_a, v_cli_a, '2026-11-01', u_a) returning id into v_linha;
  insert into linhas_editoriais (conta_id, cliente_id, periodo, created_by)
    values (v_a, v_cli_a, '2026-12-01', u_a) returning id into v_linha2;

  v_e := pg_temp.erro(u_a, format('insert into public.linha_editorial_colunas (conta_id, nome, tipo, ordem) values (%L, ''Pilar'', ''select'', 0)', v_a));
  assert v_e is null, 'owner inserts a coluna: ' || coalesce(v_e, '');
  select id into v_col from linha_editorial_colunas where conta_id = v_a;
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha, v_a, '2026-11-03', 'Post 1', 0));
  assert v_e is null, 'owner inserts an item: ' || coalesce(v_e, '');
  select id into v_item from linha_editorial_itens where linha_id = v_linha;
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, v_item, 'comentario', true, u_a));
  assert v_e is null, 'owner inserts a team comentario: ' || coalesce(v_e, '');
  select id into v_resp from linha_editorial_respostas where linha_id = v_linha;
  -- "Nova linha" inserts optimistically with a client uuid
  v_item2 := gen_random_uuid();
  v_e := pg_temp.erro(u_a, format('insert into public.linha_editorial_itens (id, linha_id, conta_id, data, tipo, ordem) values (%L, %L, %L, null, ''reels'', 1)', v_item2, v_linha, v_a));
  assert v_e is null, 'insert with a client uuid and no data: ' || coalesce(v_e, '');

  -- ---------- rls_isolation ----------
  foreach v_t in array v_tables loop
    assert pg_temp.vistos(u_a, v_t) >= 1, format('owner sees its %s', v_t);
    assert pg_temp.vistos(u_b, v_t) = 0, format('another conta sees 0 rows of %s', v_t);
  end loop;
  assert pg_temp.afetadas(u_b, format('update public.linha_editorial_itens set titulo = ''x'' where id = %L', v_item)) = 0,
    'another conta updates no item';
  assert pg_temp.afetadas(u_b, format('delete from public.linha_editorial_colunas where id = %L', v_col)) = 0,
    'another conta deletes no coluna';
  raise notice 'PASS rls_isolation';

  -- ---------- insert_into_other_conta_linha_refused ----------
  v_e := pg_temp.erro(u_b, format(v_ins_item, v_linha, v_b, '2026-11-04', 'Intruso', 5));
  assert v_e like '%linha_nao_encontrada%', 'item into another conta''s linha (own conta_id): ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format(v_ins_item, v_linha, v_a, '2026-11-04', 'Intruso', 5));
  assert v_e like '%linha_nao_encontrada%', 'item into another conta''s linha (its conta_id): ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format(v_ins_resp, v_b, v_linha, null, 'comentario', true, u_b));
  assert v_e like '%linha_nao_encontrada%', 'resposta on another conta''s linha: ' || coalesce(v_e, 'null');
  -- even bypassing RLS, a conta mismatch is refused (trigger + composite FK)
  v_e := pg_temp.erro_sr(format(v_ins_item, v_linha, v_b, '2026-11-04', 'Intruso', 5));
  assert v_e is not null, 'service_role item with a foreign conta_id refused';
  v_e := pg_temp.erro_sr(format(v_ins_resp, v_b, v_linha, null, 'comentario', true, u_b));
  assert v_e is not null, 'service_role resposta with a foreign conta_id refused';
  v_e := pg_temp.erro_sr(format('insert into public.linhas_editoriais (conta_id, cliente_id, periodo) values (%L, %s, ''2027-01-01'')', v_b, v_cli_a));
  assert v_e like '23503:%', 'linha for another conta''s cliente refused by the composite FK: ' || coalesce(v_e, 'null');
  raise notice 'PASS insert_into_other_conta_linha_refused';

  -- ---------- status_not_writable ----------
  v_e := pg_temp.erro(u_a, format('update public.linhas_editoriais set status = ''aprovada'' where id = %L', v_linha));
  assert v_e like '42501:%', 'status update denied: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('update public.linhas_editoriais set rodada = 5 where id = %L', v_linha));
  assert v_e like '42501:%', 'rodada update denied: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('insert into public.linhas_editoriais (conta_id, cliente_id, periodo) values (%L, %s, ''2027-02-01'')', v_a, v_cli_a));
  assert v_e like '42501:%', 'direct linha insert denied: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('insert into public.linha_editorial_itens (linha_id, conta_id, tipo, ordem, post_id) values (%L, %L, ''feed'', 9, 1)', v_linha, v_a));
  assert v_e like '42501:%', 'item insert with post_id denied: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set post_id = 1 where id = %L', v_item));
  assert v_e like '42501:%', 'item post_id update denied: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, null, 'aprovado', true, u_a));
  assert v_e like '42501:%', 'team resposta with acao aprovado refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, null, 'comentario', false, u_a));
  assert v_e like '42501:%', 'resposta posing as the client refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, null, 'comentario', true, u_b));
  assert v_e like '42501:%', 'resposta authored as someone else refused: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(u_a, format('update public.linhas_editoriais set updated_at = now() where id = %L', v_linha)) = 1,
    'updated_at stays writable';
  raise notice 'PASS status_not_writable';

  -- ---------- periodo_first_day ----------
  v_e := pg_temp.erro_sr(format('insert into public.linhas_editoriais (conta_id, cliente_id, periodo) values (%L, %s, ''2026-11-02'')', v_a, v_cli_a));
  assert v_e like '23514:%', 'periodo off the 1st refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format('insert into public.linhas_editoriais (conta_id, cliente_id, periodo) values (%L, %s, ''2026-11-01'')', v_a, v_cli_a));
  assert v_e like '23505:%', 'second linha for the same client and month refused: ' || coalesce(v_e, 'null');
  raise notice 'PASS periodo_first_day';

  -- ---------- date_in_month ----------
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha, v_a, '2026-12-01', 'Dezembro', 3));
  assert v_e like '%linha_item_data_fora_do_mes%', 'item dated outside the month refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha, v_a, '2026-10-31', 'Outubro', 3));
  assert v_e like '%linha_item_data_fora_do_mes%', 'item dated the month before refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set data = ''2026-12-01'' where id = %L', v_item));
  assert v_e like '%linha_item_data_fora_do_mes%', 'moving an item out of the month refused: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_itens set data = ''2026-11-30'' where id = %L', v_item)) = 1,
    'moving an item inside the month accepted';
  raise notice 'PASS date_in_month';

  -- ---------- nome_norm_unique ----------
  v_e := pg_temp.erro(u_a, format('insert into public.linha_editorial_colunas (conta_id, nome, tipo, ordem) values (%L, ''pílar '', ''text'', 1)', v_a));
  assert v_e like '23505:%', '"pílar " after "Pilar" refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_b, format('insert into public.linha_editorial_colunas (conta_id, nome, tipo, ordem) values (%L, ''Pilar'', ''select'', 0)', v_b));
  assert v_e is null, 'another conta can have its own "Pilar": ' || coalesce(v_e, '');
  assert public.linha_nome_norm('  Referência ') = 'referencia', 'linha_nome_norm trims, unaccents and lowercases';
  raise notice 'PASS nome_norm_unique';

  -- ---------- resposta_item_of_other_linha_refused ----------
  insert into linha_editorial_itens (linha_id, conta_id, data, tipo, ordem)
    values (v_linha2, v_a, '2026-12-05', 'feed', 0);
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, (select id from linha_editorial_itens where linha_id = v_linha2), 'comentario', true, u_a));
  assert v_e like '23503:%', 'resposta pointing at an item of another linha refused: ' || coalesce(v_e, 'null');
  raise notice 'PASS resposta_item_of_other_linha_refused';

  -- ---------- resposta_rodada_stamped ----------
  update linhas_editoriais set rodada = 3 where id = v_linha;
  v_e := pg_temp.erro_sr(format('insert into public.linha_editorial_respostas (conta_id, linha_id, acao, comentario, rodada, is_workspace_user, author_user_id) values (%L, %L, ''comentario'', ''r99'', 99, true, %L)', v_a, v_linha, u_a));
  assert v_e is null, 'service_role resposta insert: ' || coalesce(v_e, '');
  select rodada into v_r from linha_editorial_respostas where linha_id = v_linha and comentario = 'r99';
  assert v_r = 3, format('resposta rodada stamped from the linha, got %s', v_r);
  raise notice 'PASS resposta_rodada_stamped';

  -- ---------- linha_id_immutable ----------
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set linha_id = %L where id = %L', v_linha2, v_item));
  assert v_e like '42501:%', 'authenticated cannot write linha_id: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format('update public.linha_editorial_itens set linha_id = %L where id = %L', v_linha2, v_item));
  assert v_e like '%linha_item_linha_imutavel%', 'linha_id immutable even for service_role: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format('update public.linha_editorial_itens set conta_id = %L where id = %L', v_b, v_item));
  assert v_e is not null, 'conta_id immutable even for service_role';
  raise notice 'PASS linha_id_immutable';

  -- ---------- freeze_after_conversion ----------
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (u_a, v_a, v_cli_a, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (v_wf, v_a, 'Post 1', 0, 'rascunho') returning id into v_post;
  v_e := pg_temp.erro_sr(format('update public.linha_editorial_itens set post_id = %s, convertido_at = now(), convertido_por = %L where id = %L', v_post, u_a, v_item));
  assert v_e is null, 'service_role sets post_id: ' || coalesce(v_e, '');
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set titulo = ''Outro'' where id = %L', v_item));
  assert v_e like '%linha_item_convertido%', 'titulo frozen after conversion: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('update public.linha_editorial_itens set valores = ''{"x": 1}'' where id = %L', v_item));
  assert v_e like '%linha_item_convertido%', 'valores frozen after conversion: ' || coalesce(v_e, 'null');
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_itens set ordem = 7 where id = %L', v_item)) = 1,
    'ordem stays editable after conversion';
  -- a post in another conta can never be linked (composite FK)
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (u_b, v_b, v_cli_b, 'WF B', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (v_wf, v_b, 'Post B', 0, 'rascunho') returning id into v_n;
  v_e := pg_temp.erro_sr(format('update public.linha_editorial_itens set post_id = %s where id = %L', v_n, v_item2));
  assert v_e like '23503:%', 'linking a post of another conta refused: ' || coalesce(v_e, 'null');
  -- deleting the post releases the item (ON DELETE SET NULL (post_id) cascades through the freeze)
  delete from workflow_posts where id = v_post;
  assert (select post_id is null and titulo = 'Post 1' and ordem = 7 and conta_id = v_a
            from linha_editorial_itens where id = v_item),
    'post delete nulls post_id and keeps the row values';
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_itens set titulo = ''Editável'' where id = %L', v_item)) = 1,
    'released item is editable again';
  raise notice 'PASS freeze_after_conversion';

  -- ---------- item_delete_nulls_resposta_item_id ----------
  insert into linha_editorial_itens (linha_id, conta_id, data, tipo, ordem)
    values (v_linha, v_a, '2026-11-10', 'stories', 20) returning id into v_item_del;
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, v_item_del, 'comentario', true, u_a));
  assert v_e is null, 'reply on the item: ' || coalesce(v_e, '');
  select id into v_item2 from linha_editorial_respostas where item_id = v_item_del;
  assert pg_temp.afetadas(u_a, format('delete from public.linha_editorial_itens where id = %L', v_item_del)) = 1,
    'item with replies deleted';
  assert (select item_id is null and linha_id = v_linha from linha_editorial_respostas where id = v_item2),
    'the reply survives with item_id null';
  raise notice 'PASS item_delete_nulls_resposta_item_id';

  -- ---------- cap_100 ----------
  insert into linhas_editoriais (conta_id, cliente_id, periodo) values (v_a, v_cli_a, '2027-01-01') returning id into v_linha_cap;
  insert into linha_editorial_itens (linha_id, conta_id, tipo, ordem)
    select v_linha_cap, v_a, 'feed', g from generate_series(1, 99) g;
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha_cap, v_a, '2027-01-02', '100', 100));
  assert v_e is null, 'the 100th item is accepted: ' || coalesce(v_e, '');
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha_cap, v_a, '2027-01-02', '101', 101));
  assert v_e like '%linha_item_limite%', 'the 101st item refused: ' || coalesce(v_e, 'null');
  raise notice 'PASS cap_100';

  -- ---------- writes_blocked_flag_off ----------
  delete from workspace_plan_overrides where workspace_id = v_a;
  assert not effective_plan_feature(v_a, 'feature_linha_editorial'), 'flag resolves off without the override';
  foreach v_t in array v_tables loop
    assert pg_temp.vistos(u_a, v_t) >= 1, format('flag off: %s still readable', v_t);
  end loop;
  -- INSERT
  v_e := pg_temp.erro(u_a, format('insert into public.linha_editorial_colunas (conta_id, nome, tipo, ordem) values (%L, ''CTA'', ''select'', 2)', v_a));
  assert v_e like '42501:%', 'flag off: coluna insert refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_item, v_linha, v_a, '2026-11-05', 'Off', 30));
  assert v_e like '42501:%', 'flag off: item insert refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format(v_ins_resp, v_a, v_linha, null, 'comentario', true, u_a));
  assert v_e like '42501:%', 'flag off: resposta insert refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('insert into public.linhas_editoriais (conta_id, cliente_id, periodo) values (%L, %s, ''2027-03-01'')', v_a, v_cli_a));
  assert v_e like '42501:%', 'flag off: linha insert refused: ' || coalesce(v_e, 'null');
  -- UPDATE
  assert pg_temp.afetadas(u_a, format('update public.linhas_editoriais set updated_at = now() where id = %L', v_linha)) in (-1, 0),
    'flag off: linha update blocked';
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_colunas set nome = ''Pilar 2'' where id = %L', v_col)) in (-1, 0),
    'flag off: coluna update blocked';
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_itens set titulo = ''Off'' where id = %L', v_item)) in (-1, 0),
    'flag off: item update blocked';
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_respostas set comentario = ''x'' where id = %L', v_resp)) in (-1, 0),
    'flag off: resposta update blocked';
  -- DELETE
  assert pg_temp.afetadas(u_a, format('delete from public.linhas_editoriais where id = %L', v_linha)) in (-1, 0),
    'flag off: linha delete blocked';
  assert pg_temp.afetadas(u_a, format('delete from public.linha_editorial_colunas where id = %L', v_col)) in (-1, 0),
    'flag off: coluna delete blocked';
  assert pg_temp.afetadas(u_a, format('delete from public.linha_editorial_itens where id = %L', v_item)) in (-1, 0),
    'flag off: item delete blocked';
  assert pg_temp.afetadas(u_a, format('delete from public.linha_editorial_respostas where id = %L', v_resp)) in (-1, 0),
    'flag off: resposta delete blocked';
  -- nothing moved
  assert (select titulo from linha_editorial_itens where id = v_item) = 'Editável', 'flag off: item untouched';
  assert (select nome from linha_editorial_colunas where id = v_col) = 'Pilar', 'flag off: coluna untouched';
  assert exists (select 1 from linhas_editoriais where id = v_linha), 'flag off: linha still there';
  assert exists (select 1 from linha_editorial_respostas where id = v_resp), 'flag off: resposta still there';
  -- flag back on: writes resume
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_a, '{"feature_linha_editorial": true}');
  assert pg_temp.afetadas(u_a, format('update public.linha_editorial_itens set titulo = ''On'' where id = %L', v_item)) = 1,
    'flag on again: item update works';
  raise notice 'PASS writes_blocked_flag_off';

  -- ---------- grants ----------
  foreach v_t in array v_tables loop
    assert not has_table_privilege('anon', 'public.' || v_t, 'SELECT'), format('anon cannot select %s', v_t);
    assert not has_table_privilege('authenticated', 'public.' || v_t, 'TRUNCATE'), format('authenticated cannot truncate %s', v_t);
  end loop;
  assert not has_table_privilege('authenticated', 'public.linhas_editoriais', 'INSERT'), 'no insert on linhas';
  assert not has_table_privilege('authenticated', 'public.linhas_editoriais', 'DELETE'), 'no delete on linhas';
  assert not has_column_privilege('authenticated', 'public.linha_editorial_itens', 'post_id', 'INSERT'), 'post_id not insertable';
  assert not has_column_privilege('authenticated', 'public.linha_editorial_itens', 'convertido_at', 'UPDATE'), 'convertido_at not updatable';
  assert not has_column_privilege('authenticated', 'public.linha_editorial_respostas', 'rodada', 'INSERT'), 'rodada not insertable';
  assert not has_column_privilege('authenticated', 'public.linha_editorial_respostas', 'token', 'INSERT'), 'token not insertable';
  assert not has_column_privilege('authenticated', 'public.linha_editorial_colunas', 'conta_id', 'UPDATE'), 'coluna conta_id not updatable';
  assert has_table_privilege('service_role', 'public.linha_editorial_itens', 'INSERT, UPDATE, DELETE'), 'service_role holds writes';
  raise notice 'PASS grants';
end $$;

rollback;
