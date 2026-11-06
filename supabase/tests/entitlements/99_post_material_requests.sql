-- supabase/tests/entitlements/99_post_material_requests.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Pedido de material do post (migration 20261121000001, spec
-- 2026-11-06-posts-aguardando-material-design.md).
-- (a) esquema, ACL, FKs compostas, CHECKs e cascatas; (b) RPC de salvar:
-- abrir, editar itens, cancelar, reabrir (+ ACL das RPCs); (c) erros do
-- salvar; (d) upload em rascunho: item obrigatório, pedido encerrado;
-- (e) conclusão automática com uma notificação; (f) post em enviado_cliente
-- com pedido aberto: referência livre não marca item; (g) "Enviei o que
-- tenho"; (h) can_remove de arquivo de item; (i) remoção pela equipe reabre;
-- (j) gatilho de status cancela; (k) salvar da equipe conclui ou reabre sem
-- notificar; (l) post_material_requests_for e post_material_summary;
-- (m) post agendado/postado/falha_publicacao nunca reabre nem aceita item;
-- (n) rodada de revisão: arquivo de item trava ao fechar (também em
-- enviado_cliente), salvar não reabre concluido sem item novo, espaço em branco.
--
-- now() é fixo dentro da transação: para provar que opened_at foi
-- reescrito, a linha é antes empurrada para o passado.

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

-- ---- helpers das RPCs ----
create or replace function pg_temp.pm_post_s(p_ws uuid, p_wf bigint, p_status text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (p_wf, p_ws, 'Post', p_status) returning id into v_id;
  return v_id;
end $$;

-- Segundo cliente (e workflow) no mesmo workspace.
create or replace function pg_temp.pm_client(p_ws uuid, p_usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (p_usr, p_ws, 'Outro', 'O', '#111') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (p_usr, p_ws, cli, 'WF2', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.pm_file(p_ws uuid, p_cli bigint, p_post bigint, p_item bigint)
returns post_references language plpgsql as $$
begin
  return post_reference_file_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'material_item_id', p_item,
    'r2_key', 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.bin',
    'thumbnail_r2_key', 'contas/' || p_ws || '/files/' || gen_random_uuid() || '.thumb.webp',
    'name', 'arquivo', 'mime_type', 'image/png', 'file_kind', 'image', 'size_bytes', 100,
    'width', '1080', 'height', '1350', 'duration_seconds', '', 'blur_data_url', '',
    'note', ''));
end $$;

create or replace function pg_temp.pm_link(p_ws uuid, p_cli bigint, p_post bigint, p_item bigint)
returns post_references language plpgsql as $$
begin
  return post_reference_link_insert(jsonb_build_object(
    'post_id', p_post, 'conta_id', p_ws, 'cliente_id', p_cli,
    'material_item_id', p_item,
    'url', 'https://example.com/' || gen_random_uuid(), 'link_title', 'Ex', 'note', ''));
end $$;

create or replace function pg_temp.pm_save(p_ws uuid, p_post bigint, p_usr uuid, p_open boolean, p_items jsonb)
returns jsonb language sql as $$
  select post_material_request_save(p_ws, p_post, p_usr, p_open, p_items);
$$;

-- n itens {label: 'Item k'}
create or replace function pg_temp.pm_items(n int)
returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', 'Item ' || g) order by g), '[]'::jsonb)
    from generate_series(1, n) g;
$$;

create or replace function pg_temp.pm_item_id(r jsonb, i int)
returns bigint language sql as $$ select (r->'items'->i->>'id')::bigint $$;

create or replace function pg_temp.pm_req(p_post bigint)
returns post_material_requests language sql as $$
  select * from post_material_requests where post_id = p_post
$$;

create or replace function pg_temp.pm_notifs(p_post bigint)
returns int language sql as $$
  select count(*)::int from notifications
   where type = 'post_material_complete' and metadata->>'post_id' = p_post::text
$$;

-- Roda o SQL esperando P0001 com a mensagem exata.
create or replace function pg_temp.pm_expect(p_sql text, p_code text)
returns void language plpgsql as $$
declare v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when sqlstate 'P0001' then
    assert sqlerrm = p_code, format('esperava %s, veio %s', p_code, sqlerrm);
    v_raised := true;
  end;
  assert v_raised, format('esperava %s de: %s', p_code, p_sql);
end $$;

-- ---- (b) salvar: abrir, editar, cancelar, reabrir; ACL ----
begin;
do $$
declare
  e record;
  v_fn text;
  v_p bigint; v_r jsonb; v_i1 bigint; v_i2 bigint; v_ref post_references;
  v_req post_material_requests;
  v_usr2 uuid := gen_random_uuid();
begin
  foreach v_fn in array array[
    'public.post_material_request_save(uuid, bigint, uuid, boolean, jsonb)',
    'public.post_material_client_close(uuid, bigint, bigint)',
    'public.post_reference_team_delete(uuid, bigint)',
    'public.post_material_requests_for(uuid, bigint)',
    'public.post_material_summary(uuid, bigint[])',
    'public.post_reference_list(bigint, uuid)',
    'public.post_reference_file_insert(jsonb)',
    'public.post_reference_link_insert(jsonb)',
    'public.post_reference_can_remove(bigint)',
    'public.create_post_material_notification(bigint, text, integer, integer)'
  ] loop
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role executa %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon nao executa %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated nao executa %s', v_fn);
  end loop;
  foreach v_fn in array array[
    'public._post_material_complete_check(bigint, boolean, text)',
    'public._post_material_request_json(bigint)',
    'public.post_material_cancel_on_status()'
  ] loop
    assert not has_function_privilege('service_role', v_fn, 'EXECUTE'), format('service_role nao executa %s', v_fn);
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon nao executa %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated nao executa %s', v_fn);
  end loop;

  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');

  -- desligar sem pedido: nada a cancelar
  assert pg_temp.pm_save(e.ws, v_p, e.usr, false, '[]') is null, 'desligar sem pedido devolve null';
  assert pg_temp.pm_req(v_p) is null, 'nenhuma linha criada';

  -- abre com 2 itens
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true,
    '[{"label":"  Foto da fachada ","detail":"De dia"},{"label":"Logo","detail":""}]');
  assert v_r ?& array['id','post_id','status','closed_by','closed_at','opened_by','opened_at','items'], 'chaves do pedido: ' || v_r;
  assert (v_r->>'post_id')::bigint = v_p, 'post_id';
  assert v_r->>'status' = 'aberto', 'aberto';
  assert v_r->'closed_by' = 'null'::jsonb and v_r->'closed_at' = 'null'::jsonb, 'closed_* nulos';
  assert (v_r->>'opened_by')::uuid = e.usr, 'opened_by';
  assert jsonb_array_length(v_r->'items') = 2, '2 itens';
  assert v_r->'items'->0 ?& array['id','label','detail','position','file_count','done'], 'chaves do item: ' || (v_r->'items'->0);
  assert v_r->'items'->0->>'label' = 'Foto da fachada', 'label aparado';
  assert v_r->'items'->0->>'detail' = 'De dia', 'detail';
  assert v_r->'items'->1->'detail' = 'null'::jsonb, 'detail vazio vira null';
  assert (v_r->'items'->0->>'position')::int = 0 and (v_r->'items'->1->>'position')::int = 1, 'posicoes 0,1';
  assert (v_r->'items'->0->>'file_count')::int = 0 and (v_r->'items'->0->>'done')::boolean = false, 'sem arquivo';
  v_i1 := pg_temp.pm_item_id(v_r, 0);
  v_i2 := pg_temp.pm_item_id(v_r, 1);

  -- arquivo no item 2, depois o item 2 sai da lista
  v_ref := pg_temp.pm_file(e.ws, e.cli, v_p, v_i2);
  assert v_ref.material_item_id = v_i2, 'referencia ligada ao item';
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true,
    jsonb_build_array(jsonb_build_object('id', v_i1, 'label', 'Foto 2'),
                      jsonb_build_object('label', 'Novo')));
  assert jsonb_array_length(v_r->'items') = 2, 'continua com 2 itens';
  assert pg_temp.pm_item_id(v_r, 0) = v_i1, 'item 1 mantido';
  assert v_r->'items'->0->>'label' = 'Foto 2', 'item 1 atualizado';
  assert v_r->'items'->0->'detail' = 'null'::jsonb, 'detail ausente vira null';
  assert pg_temp.pm_item_id(v_r, 1) not in (v_i1, v_i2), 'item novo';
  assert not exists (select 1 from post_material_items where id = v_i2), 'item 2 apagado';
  assert (select material_item_id from post_references where id = v_ref.id) is null,
    'arquivo do item apagado vira referencia livre';
  assert v_r->>'status' = 'aberto', 'segue aberto';

  -- reordena
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true,
    jsonb_build_array(jsonb_build_object('id', pg_temp.pm_item_id(v_r, 1), 'label', 'Novo'),
                      jsonb_build_object('id', v_i1, 'label', 'Foto 2')));
  assert pg_temp.pm_item_id(v_r, 1) = v_i1 and (v_r->'items'->1->>'position')::int = 1, 'reordenado';

  -- desligar: cancelado/team, itens mantidos (p_items ignorado)
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, false, '[]');
  assert v_r->>'status' = 'cancelado' and v_r->>'closed_by' = 'team', 'cancelado/team';
  assert v_r->>'closed_at' is not null, 'closed_at';
  assert jsonb_array_length(v_r->'items') = 2, 'itens mantidos';

  -- reabre por outro usuário: reescreve opened_by/opened_at, limpa closed_*
  insert into auth.users (id) values (v_usr2);
  insert into workspace_members (user_id, workspace_id, role) values (v_usr2, e.ws, 'admin');
  update post_material_requests set opened_at = now() - interval '1 day' where post_id = v_p;
  v_r := pg_temp.pm_save(e.ws, v_p, v_usr2, true, v_r->'items');
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'aberto', 'reaberto';
  assert v_req.opened_by = v_usr2, 'opened_by reescrito';
  assert v_req.opened_at >= now() - interval '1 minute', 'opened_at reescrito';
  assert v_req.closed_by is null and v_req.closed_at is null, 'closed_* limpos';
  assert jsonb_array_length(v_r->'items') = 2, 'mesmos itens';

  -- editar um pedido já aberto não troca quem abriu
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, v_r->'items');
  assert (pg_temp.pm_req(v_p)).opened_by = v_usr2, 'editar nao reescreve opened_by';
  raise notice 'PASS 99_post_material_requests (b) salvar';
end $$;
rollback;

-- ---- (c) erros do salvar ----
begin;
do $$
declare
  e record; o record;
  v_p bigint; v_p2 bigint; v_r jsonb; v_other bigint;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');

  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, '[]'), 'items_required');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, null)', e.ws, v_p, e.usr), 'items_required');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, pg_temp.pm_items(11)), 'too_many_items');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, '[{"label":"   "}]'), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
    jsonb_build_array(jsonb_build_object('label', repeat('x', 121)))), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
    jsonb_build_array(jsonb_build_object('label', 'ok', 'detail', repeat('d', 301)))), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, '[{"detail":"x"}]'), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, '[{"label":5}]'), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr, '{"label":"x"}'), 'invalid_item');
  assert pg_temp.pm_req(v_p) is null, 'nada gravado nos erros';
  -- 10 itens e 120 caracteres passam
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(10));
  assert jsonb_array_length(v_r->'items') = 10, '10 itens ok';
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true,
    jsonb_build_array(jsonb_build_object('label', repeat('x', 120), 'detail', repeat('d', 300))));
  assert jsonb_array_length(v_r->'items') = 1, '120/300 ok';

  -- id de item de outro post, e id repetido
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_other := pg_temp.pm_item_id(pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(1)), 0);
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
    jsonb_build_array(jsonb_build_object('id', v_other, 'label', 'x'))), 'invalid_item');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
    jsonb_build_array(jsonb_build_object('id', pg_temp.pm_item_id(v_r, 0), 'label', 'x'),
                      jsonb_build_object('id', pg_temp.pm_item_id(v_r, 0), 'label', 'y'))), 'invalid_item');

  -- itens + referências livres > 10
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente');
  perform pg_temp.pm_link(e.ws, e.cli, v_p2, null);
  perform pg_temp.pm_link(e.ws, e.cli, v_p2, null);
  perform pg_temp.pm_link(e.ws, e.cli, v_p2, null);
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p2, e.usr, pg_temp.pm_items(8)), 'too_many_items');
  v_r := pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(7));
  assert jsonb_array_length(v_r->'items') = 7, '7 itens + 3 livres = 10 ok';
  -- arquivo no item 1; tirar o item 1 e pôr outro no lugar vira 4 livres + 7 itens
  perform pg_temp.pm_file(e.ws, e.cli, v_p2, pg_temp.pm_item_id(v_r, 0));
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p2, e.usr,
    (v_r->'items') - 0 || '[{"label":"Outro"}]'::jsonb), 'too_many_items');

  -- status que não aceita pedido
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws,
    pg_temp.pm_post_s(e.ws, e.wf, 'agendado'), e.usr, pg_temp.pm_items(1)), 'post_not_requestable');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws,
    pg_temp.pm_post_s(e.ws, e.wf, 'postado'), e.usr, pg_temp.pm_items(1)), 'post_not_requestable');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws,
    pg_temp.pm_post_s(e.ws, e.wf, 'falha_publicacao'), e.usr, pg_temp.pm_items(1)), 'post_not_requestable');

  -- post de outro workspace / inexistente
  select * into o from pg_temp.pm_env();
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', o.ws, v_p, o.usr, pg_temp.pm_items(1)), 'post_not_found');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, false, %L)', o.ws, v_p, o.usr, '[]'), 'post_not_found');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, -1, e.usr, pg_temp.pm_items(1)), 'post_not_found');
  raise notice 'PASS 99_post_material_requests (c) erros do salvar';
end $$;
rollback;

-- ---- (d) upload em rascunho ----
begin;
do $$
declare
  e record;
  v_p bigint; v_p2 bigint; v_r jsonb; v_i1 bigint; v_i2 bigint; v_other bigint;
  v_ref post_references;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');

  -- sem pedido: comportamento antigo
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, null)', e.ws, e.cli, v_p), 'post_not_pending');
  perform pg_temp.pm_expect(format('select pg_temp.pm_link(%L, %s, %s, null)', e.ws, e.cli, v_p), 'post_not_pending');

  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));
  v_i1 := pg_temp.pm_item_id(v_r, 0);
  v_i2 := pg_temp.pm_item_id(v_r, 1);

  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, null)', e.ws, e.cli, v_p), 'item_required');
  perform pg_temp.pm_expect(format('select pg_temp.pm_link(%L, %s, %s, null)', e.ws, e.cli, v_p), 'item_required');

  v_ref := pg_temp.pm_file(e.ws, e.cli, v_p, v_i1);
  assert v_ref.material_item_id = v_i1 and v_ref.kind = 'file', 'arquivo no item';
  v_ref := pg_temp.pm_link(e.ws, e.cli, v_p, v_i1);
  assert v_ref.material_item_id = v_i1 and v_ref.kind = 'link', 'link no item';
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'item 2 falta';

  -- item de pedido de outro post
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_other := pg_temp.pm_item_id(pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(1)), 0);
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, e.cli, v_p, v_other), 'request_closed');
  -- item inexistente
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, e.cli, v_p, -1), 'request_closed');

  -- equipe desliga: o item do pedido cancelado responde request_closed
  perform pg_temp.pm_save(e.ws, v_p, e.usr, false, '[]');
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, e.cli, v_p, v_i2), 'request_closed');
  perform pg_temp.pm_expect(format('select pg_temp.pm_link(%L, %s, %s, %s)', e.ws, e.cli, v_p, v_i2), 'request_closed');
  -- sem item, pedido cancelado: post_not_pending (como antes)
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, null)', e.ws, e.cli, v_p), 'post_not_pending');
  -- cliente errado continua post_not_found
  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, -1, v_p, v_i2), 'post_not_found');
  raise notice 'PASS 99_post_material_requests (d) upload em rascunho';
end $$;
rollback;

-- ---- (e) conclusão automática ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; v_i1 bigint; v_i2 bigint;
  v_req post_material_requests; v_n notifications;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));
  v_i1 := pg_temp.pm_item_id(v_r, 0);
  v_i2 := pg_temp.pm_item_id(v_r, 1);

  perform pg_temp.pm_file(e.ws, e.cli, v_p, v_i1);
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'um de dois: aberto';
  assert pg_temp.pm_notifs(v_p) = 0, 'sem notificacao ainda';

  perform pg_temp.pm_file(e.ws, e.cli, v_p, v_i2);
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'concluido' and v_req.closed_by = 'auto' and v_req.closed_at is not null, 'concluido/auto';
  assert pg_temp.pm_notifs(v_p) = 1, 'exatamente uma notificacao';
  select * into v_n from notifications where type = 'post_material_complete' and metadata->>'post_id' = v_p::text;
  assert v_n.user_id = e.usr, 'dono notificado';
  assert v_n.cliente_id = e.cli, 'cliente_id gravado';
  assert v_n.metadata->>'closed_by' = 'auto', 'closed_by auto';
  assert (v_n.metadata->>'done')::int = 2 and (v_n.metadata->>'total')::int = 2, 'done=2 total=2: ' || v_n.metadata;
  assert v_n.metadata->>'client_name' = 'Cliente' and v_n.metadata->>'post_title' = 'Post', 'nomes no metadata';
  assert v_n.link = '/entregas?drawer=' || e.wf, 'link do drawer';

  perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, e.cli, v_p, v_i1), 'request_closed');
  assert pg_temp.pm_notifs(v_p) = 1, 'ainda uma notificacao';

  -- sem coalescência: reabrir e concluir de novo notifica outra vez
  perform pg_temp.pm_save(e.ws, v_p, e.usr, true, v_r->'items' || '[{"label":"Mais"}]'::jsonb);
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'reaberto com item novo';
  perform pg_temp.pm_link(e.ws, e.cli, v_p, (select id from post_material_items where post_id = v_p and label = 'Mais'));
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido de novo';
  assert pg_temp.pm_notifs(v_p) = 2, 'segunda notificacao, sem coalescencia';
  raise notice 'PASS 99_post_material_requests (e) conclusao automatica';
end $$;
rollback;

-- ---- (f) enviado_cliente com pedido aberto ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; v_ref post_references; v_s record;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));

  v_ref := pg_temp.pm_file(e.ws, e.cli, v_p, null);
  assert v_ref.material_item_id is null, 'arquivo livre';
  v_ref := pg_temp.pm_link(e.ws, e.cli, v_p, null);
  assert v_ref.material_item_id is null, 'link livre';
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'segue aberto';
  select * into v_s from post_material_summary(e.ws, array[v_p]);
  assert v_s.done = 0 and v_s.total = 2, 'nenhum item marcado';
  assert pg_temp.pm_notifs(v_p) = 0, 'sem notificacao';

  -- item também funciona em enviado_cliente
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  select * into v_s from post_material_summary(e.ws, array[v_p]);
  assert v_s.done = 1 and v_s.total = 2, 'um item marcado';
  raise notice 'PASS 99_post_material_requests (f) referencia livre em enviado_cliente';
end $$;
rollback;

-- ---- (g) "Enviei o que tenho" ----
begin;
do $$
declare
  e record; c2 record;
  v_p bigint; v_p2 bigint; v_r jsonb; v_req post_material_requests; v_n notifications;
begin
  select * into e from pg_temp.pm_env();
  select * into c2 from pg_temp.pm_client(e.ws, e.usr);
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(3));

  assert post_material_client_close(e.ws, e.cli, v_p) = 'nothing_sent', 'nada enviado';
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'segue aberto';

  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  assert post_material_client_close(e.ws, c2.cli, v_p) = 'not_found', 'outro cliente';
  assert post_material_client_close(gen_random_uuid(), e.cli, v_p) = 'not_found', 'outro workspace';

  assert post_material_client_close(e.ws, e.cli, v_p) = 'ok', 'fecha';
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'concluido' and v_req.closed_by = 'client' and v_req.closed_at is not null, 'concluido/client';
  assert pg_temp.pm_notifs(v_p) = 1, 'uma notificacao';
  select * into v_n from notifications where type = 'post_material_complete' and metadata->>'post_id' = v_p::text;
  assert v_n.metadata->>'closed_by' = 'client', 'closed_by client';
  assert (v_n.metadata->>'done')::int = 1 and (v_n.metadata->>'total')::int = 3, 'done=1 total=3: ' || v_n.metadata;

  assert post_material_client_close(e.ws, e.cli, v_p) = 'request_closed', 'segunda vez';
  assert pg_temp.pm_notifs(v_p) = 1, 'ainda uma';

  -- post sem pedido
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  assert post_material_client_close(e.ws, e.cli, v_p2) = 'not_found', 'sem pedido';
  -- pedido cancelado
  perform pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_save(e.ws, v_p2, e.usr, false, '[]');
  assert post_material_client_close(e.ws, e.cli, v_p2) = 'request_closed', 'cancelado';
  raise notice 'PASS 99_post_material_requests (g) cliente encerra';
end $$;
rollback;

-- ---- (h) can_remove de arquivo de item ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; f1 post_references; f1b post_references; v_row record;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(3));

  f1 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  f1b := pg_temp.pm_link(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  assert post_reference_can_remove(f1.id), 'removivel com pedido aberto em rascunho';
  assert post_reference_client_update(f1.id, e.ws, e.cli, 'nota') = 'ok', 'nota editavel';
  assert (select note from post_references where id = f1.id) = 'nota', 'nota gravada';
  assert post_reference_client_delete(f1b.id, e.ws, e.cli) = 'ok', 'cliente remove com pedido aberto';

  -- post_reference_list traz material_item_id e can_remove
  select * into v_row from post_reference_list(v_p, e.ws) where id = f1.id;
  assert v_row.material_item_id = pg_temp.pm_item_id(v_r, 0), 'list traz material_item_id';
  assert v_row.can_remove, 'list traz can_remove';

  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 1));
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 2));
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido';
  assert not post_reference_can_remove(f1.id), 'travado depois de concluido';
  assert post_reference_client_update(f1.id, e.ws, e.cli, 'outra') = 'locked', 'nota travada';
  assert post_reference_client_delete(f1.id, e.ws, e.cli) = 'locked', 'remocao travada';
  raise notice 'PASS 99_post_material_requests (h) can_remove';
end $$;
rollback;

-- ---- (i) remoção pela equipe ----
begin;
do $$
declare
  e record; o record;
  v_p bigint; v_p2 bigint; v_r jsonb; f1 post_references; f2 post_references; f2b post_references;
  v_link post_references; v_req post_material_requests;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));
  f1 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  f2 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 1));
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido';
  assert pg_temp.pm_notifs(v_p) = 1, 'uma notificacao';

  select * into o from pg_temp.pm_env();
  assert post_reference_team_delete(o.ws, f2.id) = 'not_found', 'outro workspace';
  assert post_reference_team_delete(e.ws, -1) = 'not_found', 'inexistente';
  assert exists (select 1 from post_references where id = f2.id), 'nada apagado';

  assert post_reference_team_delete(e.ws, f2.id) = 'ok', 'apaga';
  assert not exists (select 1 from post_references where id = f2.id), 'apagado';
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'aberto' and v_req.closed_by is null and v_req.closed_at is null, 'reaberto';
  assert pg_temp.pm_notifs(v_p) = 1, 'sem notificacao nova';

  -- item com outro arquivo: apagar um não reabre
  f2b := pg_temp.pm_link(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  f2 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 1));
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido de novo';
  assert post_reference_team_delete(e.ws, f2b.id) = 'ok', 'apaga o segundo do item 1';
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'item 1 ainda tem arquivo';

  -- pedido encerrado pelo cliente: apagar referência livre não reabre
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente');
  v_r := pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(2));
  perform pg_temp.pm_file(e.ws, e.cli, v_p2, pg_temp.pm_item_id(v_r, 0));
  v_link := pg_temp.pm_link(e.ws, e.cli, v_p2, null);
  assert post_material_client_close(e.ws, e.cli, v_p2) = 'ok', 'cliente encerra';
  assert post_reference_team_delete(e.ws, v_link.id) = 'ok', 'apaga livre';
  assert (pg_temp.pm_req(v_p2)).status = 'concluido', 'livre nao reabre';
  -- referência de post sem pedido
  v_link := pg_temp.pm_link(e.ws, e.cli, pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente'), null);
  assert post_reference_team_delete(e.ws, v_link.id) = 'ok', 'apaga sem pedido';
  raise notice 'PASS 99_post_material_requests (i) remocao pela equipe';
end $$;
rollback;

-- ---- (j) gatilho de status ----
begin;
do $$
declare
  e record;
  v_p1 bigint; v_p2 bigint; v_p3 bigint; v_p4 bigint; v_r jsonb; v_req post_material_requests;
begin
  select * into e from pg_temp.pm_env();
  v_p1 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_p2 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_p3 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_p4 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  perform pg_temp.pm_save(e.ws, v_p1, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_save(e.ws, v_p2, e.usr, true, pg_temp.pm_items(1));
  v_r := pg_temp.pm_save(e.ws, v_p3, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_file(e.ws, e.cli, v_p3, pg_temp.pm_item_id(v_r, 0));
  perform pg_temp.pm_save(e.ws, v_p4, e.usr, true, pg_temp.pm_items(1));

  update workflow_posts set status = 'agendado' where id = v_p1;
  v_req := pg_temp.pm_req(v_p1);
  assert v_req.status = 'cancelado' and v_req.closed_by = 'system' and v_req.closed_at is not null, 'agendado cancela';

  update workflow_posts set status = 'postado' where id = v_p2;
  v_req := pg_temp.pm_req(v_p2);
  assert v_req.status = 'cancelado' and v_req.closed_by = 'system', 'postado cancela';

  -- concluido não muda
  update workflow_posts set status = 'agendado' where id = v_p3;
  v_req := pg_temp.pm_req(v_p3);
  assert v_req.status = 'concluido' and v_req.closed_by = 'auto', 'concluido intacto';

  -- outros status não cancelam
  update workflow_posts set status = 'enviado_cliente' where id = v_p4;
  update workflow_posts set status = 'aprovado_cliente' where id = v_p4;
  assert (pg_temp.pm_req(v_p4)).status = 'aberto', 'aprovado_cliente nao cancela';
  raise notice 'PASS 99_post_material_requests (j) gatilho de status';
end $$;
rollback;

-- ---- (k) salvar da equipe conclui ou reabre sem notificar ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; v_req post_material_requests;
begin
  select * into e from pg_temp.pm_env();
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(3));
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 1));
  assert (pg_temp.pm_req(v_p)).status = 'aberto', 'dois de tres';

  -- remove o item que faltava
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, (v_r->'items') - 2);
  assert v_r->>'status' = 'concluido' and v_r->>'closed_by' = 'auto', 'concluido/auto pelo salvar: ' || v_r;
  assert (v_r->'items'->0->>'done')::boolean and (v_r->'items'->0->>'file_count')::int = 1, 'done e file_count';
  assert pg_temp.pm_notifs(v_p) = 0, 'sem notificacao quando a equipe conclui';

  -- adiciona um item: reabre
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, (v_r->'items') || '[{"label":"Mais um"}]'::jsonb);
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'aberto' and v_req.closed_by is null and v_req.closed_at is null, 'reaberto';
  assert jsonb_array_length(v_r->'items') = 3, 'tres itens';
  assert pg_temp.pm_notifs(v_p) = 0, 'ainda sem notificacao';
  raise notice 'PASS 99_post_material_requests (k) salvar conclui ou reabre';
end $$;
rollback;

-- ---- (l) post_material_requests_for e post_material_summary ----
begin;
do $$
declare
  e record; c2 record; o record;
  v_a1 bigint; v_a2 bigint; v_a3 bigint; v_a4 bigint; v_b bigint; v_o bigint;
  v_r jsonb; v_ids bigint[]; v_req jsonb; v_n int; v_s record;
begin
  select * into e from pg_temp.pm_env();
  select * into c2 from pg_temp.pm_client(e.ws, e.usr);
  v_a1 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');         -- aberto
  v_a2 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');         -- concluido
  v_a3 := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');         -- cancelado
  v_a4 := pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente');  -- aberto
  v_b  := pg_temp.pm_post_s(e.ws, c2.wf, 'rascunho');        -- outro cliente, aberto

  v_r := pg_temp.pm_save(e.ws, v_a1, e.usr, true, pg_temp.pm_items(2));
  perform pg_temp.pm_file(e.ws, e.cli, v_a1, pg_temp.pm_item_id(v_r, 1));
  v_r := pg_temp.pm_save(e.ws, v_a2, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_file(e.ws, e.cli, v_a2, pg_temp.pm_item_id(v_r, 0));
  perform pg_temp.pm_save(e.ws, v_a3, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_save(e.ws, v_a3, e.usr, false, '[]');
  perform pg_temp.pm_save(e.ws, v_a4, e.usr, true, pg_temp.pm_items(3));
  perform pg_temp.pm_save(e.ws, v_b, e.usr, true, pg_temp.pm_items(1));

  select array_agg(post_id order by post_id) into v_ids from post_material_requests_for(e.ws, e.cli);
  assert v_ids = array[v_a1, v_a4], 'so abertos do cliente: ' || coalesce(v_ids::text, 'null');
  select request into v_req from post_material_requests_for(e.ws, e.cli) where post_id = v_a1;
  assert v_req ?& array['id','post_id','status','closed_by','closed_at','opened_by','opened_at','items'], 'forma do pedido';
  assert (v_req->>'post_id')::bigint = v_a1 and v_req->>'status' = 'aberto', 'pedido do post';
  assert (v_req->'items'->0->>'done')::boolean = false and (v_req->'items'->1->>'done')::boolean = true, 'done por item';
  assert (v_req->'items'->1->>'file_count')::int = 1, 'file_count';

  select array_agg(post_id) into v_ids from post_material_requests_for(e.ws, c2.cli);
  assert v_ids = array[v_b], 'outro cliente ve so o dele';
  select count(*) into v_n from post_material_requests_for(gen_random_uuid(), e.cli);
  assert v_n = 0, 'outro workspace: nada';

  -- resumo: só ids pedidos, do workspace
  select * into o from pg_temp.pm_env();
  v_o := pg_temp.pm_post_s(o.ws, o.wf, 'rascunho');
  perform pg_temp.pm_save(o.ws, v_o, o.usr, true, pg_temp.pm_items(1));
  select count(*) into v_n from post_material_summary(e.ws, array[v_a1, v_a2, v_o, 999999999]);
  assert v_n = 2, 'resumo so dos ids listados do workspace: ' || v_n;
  select * into v_s from post_material_summary(e.ws, array[v_a1]);
  assert v_s.post_id = v_a1 and v_s.status = 'aberto' and v_s.done = 1 and v_s.total = 2, 'resumo a1';
  select * into v_s from post_material_summary(e.ws, array[v_a2]);
  assert v_s.status = 'concluido' and v_s.done = 1 and v_s.total = 1, 'resumo a2';
  select * into v_s from post_material_summary(e.ws, array[v_a3]);
  assert v_s.status = 'cancelado' and v_s.done = 0 and v_s.total = 1, 'resumo a3';
  select count(*) into v_n from post_material_summary(e.ws, array[]::bigint[]);
  assert v_n = 0, 'lista vazia';
  raise notice 'PASS 99_post_material_requests (l) listagem e resumo';
end $$;
rollback;

-- ---- (m) post já agendado/postado/falha_publicacao ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; f1 post_references; f2 post_references; v_st text;
begin
  select * into e from pg_temp.pm_env();
  foreach v_st in array array['agendado', 'postado', 'falha_publicacao'] loop
    v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
    v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));
    f1 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
    f2 := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 1));
    assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido antes de ' || v_st;
    update workflow_posts set status = v_st where id = v_p;

    -- equipe apaga o último arquivo de um item: não reabre
    assert post_reference_team_delete(e.ws, f2.id) = 'ok', 'apaga em ' || v_st;
    assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido intacto em ' || v_st;

    -- salvar com p_open=true recusa, mesmo com pedido existente
    perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
      v_r->'items'), 'post_not_requestable');

    -- pedido aberto à força (fora do fluxo normal): upload de item recusa, can_remove falso
    update post_material_requests set status = 'aberto', closed_by = null, closed_at = null where post_id = v_p;
    perform pg_temp.pm_expect(format('select pg_temp.pm_file(%L, %s, %s, %s)', e.ws, e.cli, v_p,
      pg_temp.pm_item_id(v_r, 1)), 'request_closed');
    perform pg_temp.pm_expect(format('select pg_temp.pm_link(%L, %s, %s, %s)', e.ws, e.cli, v_p,
      pg_temp.pm_item_id(v_r, 1)), 'request_closed');
    assert not post_reference_can_remove(f1.id), 'item travado em ' || v_st;
    assert post_reference_client_delete(f1.id, e.ws, e.cli) = 'locked', 'cliente nao remove em ' || v_st;
    assert post_material_client_close(e.ws, e.cli, v_p) = 'request_closed', 'cliente nao encerra em ' || v_st;
    assert pg_temp.pm_notifs(v_p) = 1, 'sem notificacao nova em ' || v_st;
  end loop;
  raise notice 'PASS 99_post_material_requests (m) post agendado/postado nao reabre';
end $$;
rollback;

-- ---- (n) revisão: trava de item, concluido estável, espaço em branco ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; f post_references; v_free post_references;
  v_req post_material_requests; v_before post_material_requests;
  v_usr2 uuid := gen_random_uuid();
begin
  select * into e from pg_temp.pm_env();
  insert into auth.users (id) values (v_usr2);
  insert into workspace_members (user_id, workspace_id, role) values (v_usr2, e.ws, 'admin');

  -- arquivo de item em enviado_cliente trava quando o pedido conclui
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'enviado_cliente');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(1));
  v_free := pg_temp.pm_link(e.ws, e.cli, v_p, null);
  f := pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  assert (pg_temp.pm_req(v_p)).status = 'concluido', 'concluido/auto';
  assert not post_reference_can_remove(f.id), 'item travado em enviado_cliente';
  assert post_reference_client_update(f.id, e.ws, e.cli, 'x') = 'locked', 'nota do item travada';
  assert post_reference_client_delete(f.id, e.ws, e.cli) = 'locked', 'remocao do item travada';
  assert post_reference_can_remove(v_free.id), 'referencia livre segue a regra antiga';

  -- concluido/auto: editar rótulo não reabre nem mexe em closed_*/opened_*
  update post_material_requests set closed_at = now() - interval '2 hours',
         opened_at = now() - interval '1 day' where post_id = v_p;
  v_before := pg_temp.pm_req(v_p);
  v_r := pg_temp.pm_save(e.ws, v_p, v_usr2, true,
    jsonb_build_array(jsonb_build_object('id', pg_temp.pm_item_id(v_r, 0), 'label', 'Outro nome')));
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'concluido' and v_req.closed_by = 'auto' and v_req.closed_at = v_before.closed_at,
    'concluido/auto intacto';
  assert v_req.opened_by = e.usr and v_req.opened_at = v_before.opened_at, 'opened_* intactos';
  assert v_r->'items'->0->>'label' = 'Outro nome', 'rotulo salvo';

  -- concluido/auto + item novo: reabre e reescreve opened_*
  v_r := pg_temp.pm_save(e.ws, v_p, v_usr2, true, (v_r->'items') || '[{"label":"Novo"}]'::jsonb);
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'aberto' and v_req.closed_by is null and v_req.closed_at is null, 'reaberto pelo item novo';
  assert v_req.opened_by = v_usr2 and v_req.opened_at >= now() - interval '1 minute', 'opened_* reescritos';

  -- concluido/client: editar rótulo mantém concluido/client
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(2));
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  assert post_material_client_close(e.ws, e.cli, v_p) = 'ok', 'cliente encerra';
  update post_material_requests set closed_at = now() - interval '2 hours',
         opened_at = now() - interval '1 day' where post_id = v_p;
  v_before := pg_temp.pm_req(v_p);
  v_r := pg_temp.pm_save(e.ws, v_p, v_usr2, true,
    jsonb_build_array(jsonb_build_object('id', pg_temp.pm_item_id(v_r, 0), 'label', 'A'),
                      jsonb_build_object('id', pg_temp.pm_item_id(v_r, 1), 'label', 'B corrigido')));
  v_req := pg_temp.pm_req(v_p);
  assert v_req.status = 'concluido' and v_req.closed_by = 'client' and v_req.closed_at = v_before.closed_at,
    'concluido/client intacto';
  assert v_req.opened_by = e.usr and v_req.opened_at = v_before.opened_at, 'opened_* intactos (client)';
  -- dono + admin: uma notificação por alvo, todas do fechamento do cliente
  assert pg_temp.pm_notifs(v_p) = 2, 'sem notificacao nova: ' || pg_temp.pm_notifs(v_p);

  -- espaço em branco: tab/quebra de linha contam como vazio e são aparados
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  perform pg_temp.pm_expect(format('select pg_temp.pm_save(%L, %s, %L, true, %L)', e.ws, v_p, e.usr,
    jsonb_build_array(jsonb_build_object('label', E'\t\n '))), 'invalid_item');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true,
    jsonb_build_array(jsonb_build_object('label', E'\tFoto\n', 'detail', E'\n\t')));
  assert v_r->'items'->0->>'label' = 'Foto', 'label aparado de tab/quebra: ' || (v_r->'items'->0->>'label');
  assert v_r->'items'->0->'detail' = 'null'::jsonb, 'detail so de espaco vira null';
  begin
    insert into post_material_items (request_id, post_id, conta_id, label, position)
      values ((v_r->>'id')::bigint, v_p, e.ws, E'\t\n', 5);
    assert false, 'CHECK deveria recusar label so de tab/quebra';
  exception when check_violation then null; end;
  raise notice 'PASS 99_post_material_requests (n) revisao';
end $$;
rollback;

-- ---- (o) push: post_material_complete entra no claim_notification_pushes ----
begin;
do $$
declare
  e record;
  v_p bigint; v_r jsonb; v_claimed record;
begin
  select * into e from pg_temp.pm_env();
  insert into push_devices (user_id, token, platform, environment)
    values (e.usr, 't-material', 'ios', 'production');
  v_p := pg_temp.pm_post_s(e.ws, e.wf, 'rascunho');
  v_r := pg_temp.pm_save(e.ws, v_p, e.usr, true, pg_temp.pm_items(1));
  perform pg_temp.pm_file(e.ws, e.cli, v_p, pg_temp.pm_item_id(v_r, 0));
  assert pg_temp.pm_notifs(v_p) = 1, 'notificacao criada';

  select * into v_claimed from claim_notification_pushes(now() - interval '15 minutes', 100)
   where user_id = e.usr and type = 'post_material_complete';
  assert v_claimed.id is not null, 'push claim devolve post_material_complete';
  assert v_claimed.metadata->>'closed_by' = 'auto', 'metadata chega ao push';
  assert (select count(*) from claim_notification_pushes(now() - interval '15 minutes', 100)
           where type = 'post_material_complete') = 0, 'nao reclama duas vezes';
  raise notice 'PASS 99_post_material_requests (o) push';
end $$;
rollback;
