-- supabase/tests/entitlements/99_post_material_requests.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Pedido de material do post (migration 20261121000001, spec
-- 2026-11-06-posts-aguardando-material-design.md).
-- (a) esquema, ACL, FKs compostas, CHECKs e cascatas; (b) RPC de abrir/salvar;
-- (c) RPC de fechar; (d) auto-conclusão por upload; (e) cancelamento;
-- (f) reabertura; (g) limites de itens e referências; (h) listagem;
-- (i) vínculo de referência a item; (j) remoção de item; (k) exclusão do post;
-- (l) exclusão de workspace; (m) escopo por cliente; (n) idempotência.
-- As seções (b)..(n) entram nas tarefas seguintes.

create or replace function pg_temp.pm_env(out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('pro', null);
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'Cliente', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.pm_post(p_ws uuid, p_wf bigint)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (p_wf, p_ws, 'Post', 'enviado_cliente') returning id into v_id;
  return v_id;
end $$;

-- ---- (a) esquema, ACL, integridade ----
begin;
do $$
declare
  e record;
  v_p1 bigint; v_p2 bigint;
  v_r1 bigint; v_r2 bigint;
  v_i1 bigint; v_i2 bigint;
  v_ref bigint;
  v_n int;
begin
  -- ACL: nenhum papel de cliente toca nas tabelas
  assert not has_table_privilege('authenticated', 'public.post_material_requests', 'SELECT'), 'authenticated nao le requests';
  assert not has_table_privilege('authenticated', 'public.post_material_items', 'SELECT'), 'authenticated nao le items';
  assert not has_table_privilege('anon', 'public.post_material_requests', 'SELECT'), 'anon nao le requests';
  assert not has_table_privilege('anon', 'public.post_material_items', 'SELECT'), 'anon nao le items';
  assert not has_table_privilege('authenticated', 'public.post_material_requests', 'INSERT'), 'authenticated nao grava requests';
  assert not has_table_privilege('authenticated', 'public.post_material_items', 'INSERT'), 'authenticated nao grava items';
  assert has_table_privilege('service_role', 'public.post_material_requests', 'INSERT'), 'service_role grava requests';
  assert has_table_privilege('service_role', 'public.post_material_items', 'INSERT'), 'service_role grava items';
  assert (select relrowsecurity from pg_class where oid = 'public.post_material_requests'::regclass), 'RLS requests';
  assert (select relrowsecurity from pg_class where oid = 'public.post_material_items'::regclass), 'RLS items';
  assert not exists (select 1 from pg_policies where tablename in ('post_material_requests','post_material_items')),
    'sem policies';

  select * into e from pg_temp.pm_env();
  v_p1 := pg_temp.pm_post(e.ws, e.wf);
  v_p2 := pg_temp.pm_post(e.ws, e.wf);

  insert into post_material_requests (post_id, conta_id, status, opened_by)
    values (v_p1, e.ws, 'aberto', e.usr) returning id into v_r1;
  insert into post_material_requests (post_id, conta_id, status, opened_by)
    values (v_p2, e.ws, 'aberto', e.usr) returning id into v_r2;

  -- um pedido por post
  begin
    insert into post_material_requests (post_id, conta_id, status) values (v_p1, e.ws, 'aberto');
    assert false, 'esperava unique_violation';
  exception when unique_violation then null; end;

  -- CHECKs de estado
  begin
    update post_material_requests set closed_by = 'client' where id = v_r1;
    assert false, 'aberto com closed_by deveria falhar';
  exception when check_violation then null; end;
  begin
    update post_material_requests set status = 'concluido', closed_by = 'client' where id = v_r1;
    assert false, 'concluido sem closed_at deveria falhar';
  exception when check_violation then null; end;
  begin
    update post_material_requests set status = 'concluido', closed_at = now() where id = v_r1;
    assert false, 'concluido sem closed_by deveria falhar';
  exception when check_violation then null; end;
  begin
    update post_material_requests set status = 'concluido', closed_by = 'bogus', closed_at = now() where id = v_r1;
    assert false, 'closed_by invalido deveria falhar';
  exception when check_violation then null; end;
  begin
    update post_material_requests set status = 'xx' where id = v_r1;
    assert false, 'status invalido deveria falhar';
  exception when check_violation then null; end;
  -- estados válidos
  update post_material_requests set status = 'concluido', closed_by = 'auto', closed_at = now() where id = v_r1;
  update post_material_requests set status = 'cancelado', closed_by = 'team', closed_at = now() where id = v_r1;
  update post_material_requests set status = 'aberto', closed_by = null, closed_at = null where id = v_r1;

  -- itens
  insert into post_material_items (request_id, post_id, conta_id, label, detail, position)
    values (v_r1, v_p1, e.ws, 'Foto da fachada', null, 0) returning id into v_i1;
  insert into post_material_items (request_id, post_id, conta_id, label, position)
    values (v_r2, v_p2, e.ws, 'Logo', 0) returning id into v_i2;

  -- item com (request, post, conta) que não bate com o pedido
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, position)
      values (v_r1, v_p2, e.ws, 'Errado', 1);
    assert false, 'esperava foreign_key_violation (post diferente)';
  exception when foreign_key_violation then null; end;
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, position)
      values (v_r1, v_p1, gen_random_uuid(), 'Errado', 1);
    assert false, 'esperava foreign_key_violation (conta diferente)';
  exception when foreign_key_violation then null; end;

  -- CHECKs de texto
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, position)
      values (v_r1, v_p1, e.ws, '   ', 1);
    assert false, 'label em branco deveria falhar';
  exception when check_violation then null; end;
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, position)
      values (v_r1, v_p1, e.ws, repeat('x', 121), 1);
    assert false, 'label > 120 deveria falhar';
  exception when check_violation then null; end;
  insert into post_material_items (request_id, post_id, conta_id, label, position)
    values (v_r1, v_p1, e.ws, repeat('x', 120), 1);
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, detail, position)
      values (v_r1, v_p1, e.ws, 'ok', repeat('d', 301), 2);
    assert false, 'detail > 300 deveria falhar';
  exception when check_violation then null; end;
  insert into post_material_items (request_id, post_id, conta_id, label, detail, position)
    values (v_r1, v_p1, e.ws, 'ok', repeat('d', 300), 2);

  -- referência de link ligada ao item do próprio post: ok
  insert into post_references (post_id, conta_id, kind, url, material_item_id)
    values (v_p1, e.ws, 'link', 'https://example.com/a', v_i1) returning id into v_ref;

  -- referência apontando item de OUTRO post: FK composta recusa
  begin
    insert into post_references (post_id, conta_id, kind, url, material_item_id)
      values (v_p1, e.ws, 'link', 'https://example.com/b', v_i2);
    assert false, 'esperava foreign_key_violation (item de outro post)';
  exception when foreign_key_violation then null; end;

  -- apagar o item mantém a referência, só zera material_item_id
  delete from post_material_items where id = v_i1;
  select count(*) into v_n from post_references
    where id = v_ref and material_item_id is null and post_id = v_p1 and conta_id = e.ws;
  assert v_n = 1, 'referencia deve sobreviver com material_item_id nulo e post/conta intactos';

  -- apagar o pedido cascateia os itens
  delete from post_material_requests where id = v_r1;
  assert not exists (select 1 from post_material_items where request_id = v_r1), 'cascata request -> items';

  -- apagar o post cascateia pedido e itens
  delete from workflow_posts where id = v_p2;
  assert not exists (select 1 from post_material_requests where post_id = v_p2), 'cascata post -> request';
  assert not exists (select 1 from post_material_items where post_id = v_p2), 'cascata post -> items';

  -- updated_at é mantido por trigger (now() é fixo na transação: usa o passado)
  insert into post_material_requests (post_id, conta_id, status, updated_at)
    values (v_p1, e.ws, 'aberto', now() - interval '1 day') returning id into v_r1;
  update post_material_requests set status = 'aberto' where id = v_r1;
  assert (select updated_at from post_material_requests where id = v_r1) >= now() - interval '1 minute',
    'trigger de updated_at em requests';
  insert into post_material_items (request_id, post_id, conta_id, label, position, updated_at)
    values (v_r1, v_p1, e.ws, 'T', 0, now() - interval '1 day') returning id into v_i1;
  update post_material_items set label = 'T2' where id = v_i1;
  assert (select updated_at from post_material_items where id = v_i1) >= now() - interval '1 minute',
    'trigger de updated_at em items';
  raise notice 'PASS 99_post_material_requests (a) esquema, ACL, integridade';
end $$;
rollback;
