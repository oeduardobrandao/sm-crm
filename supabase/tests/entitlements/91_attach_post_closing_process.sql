\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- attach_post_closing_process (migration 20260919000007). Cobre:
-- 91.0 happy path: encerra com motivo vinculado e anexa, sem tocar o post
-- 91.1 limite do fluxo respeitado -> plan_limit_exceeded e nada muda
-- 91.2 fluxo de outro cliente, fluxo arquivado e revisao velha
-- 91.3 attach_posts_to_flow continua barrado para o mesmo post (guard da fase 1)
-- 91.4 post ja em fluxo -> post_already_in_flow; processo encerrado ->
--      process_already_closed; post sem processo nenhum -> process_not_found

create or replace function pg_temp.et_at_env(
  out ws uuid, out usr uuid, out cli bigint, out cli2 bigint,
  out post bigint, out proc bigint, out wf bigint, out wf2 bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C1', 'C1', '#000') returning id into cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C2', 'C2', '#000') returning id into cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli, 'Destino', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf, 0, 'Copy', 2, 'ativo');
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli2, 'Outro cliente', 'ativo') returning id into wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf2, 0, 'Copy', 2, 'ativo');
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso com processo', 'aprovado_cliente') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao', 'ativo', 0) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'ativo', now());
end $$;

-- 91.0
begin;
do $$
declare e record; v_res jsonb; v_status text; v_wf bigint;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := attach_post_closing_process(e.post, e.wf, 1);
  execute 'reset role';
  assert v_res ->> 'estado' = 'encerrado' and v_res ->> 'motivo_encerramento' = 'vinculado', 'encerrado com motivo vinculado';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf = e.wf, 'post anexado ao fluxo';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', 'vincular nao altera status do post';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'interrompido';
  assert found, 'a etapa ativa e interrompida';
  perform 1 from post_process_events where process_id = e.proc and evento = 'vinculado';
  assert found, 'evento vinculado';
  raise notice 'PASS 91.0 vincular encerrando a execucao';
end $$;
rollback;

-- 91.1
begin;
do $$
declare e record; v_raised boolean := false; v_wf bigint;
begin
  select * into e from pg_temp.et_at_env();
  -- et_make_workspace sem p_overrides nao cria linha em workspace_plan_overrides
  insert into workspace_plan_overrides (workspace_id, plan_id, resource_overrides)
    values (e.ws, (select plan_id from workspaces where id = e.ws), '{"max_posts_per_workflow": 1}'::jsonb);
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo) values (e.wf, e.ws, e.cli, 'ja no fluxo');

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'limite do fluxo deve barrar o vinculo';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf is null, 'post continua avulso';
  perform 1 from post_processes where id = e.proc and estado = 'ativo';
  assert found, 'a execucao nao foi encerrada';
  raise notice 'PASS 91.1 limite do fluxo';
end $$;
rollback;

-- 91.2
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf2, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_belongs_to_another_client', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outro cliente deve ser recusado';
  execute 'reset role';

  update workflows set status = 'arquivado' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo arquivado deve ser recusado';
  execute 'reset role';

  update workflows set status = 'ativo' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 99);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'revisao velha deve levantar process_changed';
  raise notice 'PASS 91.2 pre-condicoes do fluxo e revisao';
end $$;
rollback;

-- 91.3
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_posts_to_flow(array[e.post], e.wf);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'a RPC generica continua barrada pelo guard da fase 1';
  raise notice 'PASS 91.3 so attach_post_closing_process vincula';
end $$;
rollback;

-- 91.4
begin;
do $$
declare e record; v_post2 bigint; v_post3 bigint; v_proc2 bigint; v_raised boolean;
begin
  select * into e from pg_temp.et_at_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform attach_post_closing_process(e.post, e.wf, 1);
  v_raised := false;
  begin
    perform attach_post_closing_process(e.post, e.wf, 2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_already_in_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post que ja esta em fluxo deve levantar post_already_in_flow';

  -- Processo ja encerrado: a RPC trava a execucao mais recente do post sem
  -- filtrar estado, entao a resposta e process_already_closed, o mesmo codigo
  -- que remove_post_process usa (Decisao 29), e nao process_not_found.
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso encerrado', 'rascunho') returning id into v_post2;
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento)
    values (e.ws, v_post2, '0|Copy|padrao', 'encerrado', 'removido') returning id into v_proc2;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(v_post2, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_already_closed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo encerrado resolve para process_already_closed';
  perform 1 from workflow_posts where id = v_post2 and workflow_id is null;
  assert found, 'o post do processo encerrado continua avulso';
  perform 1 from post_processes where id = v_proc2 and estado = 'encerrado'
    and motivo_encerramento = 'removido';
  assert found, 'o processo encerrado nao e reescrito';

  -- Post sem execucao nenhuma: ai sim process_not_found.
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'Avulso sem processo', 'rascunho') returning id into v_post3;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(v_post3, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post sem execucao resolve para process_not_found';
  raise notice 'PASS 91.4 post ja em fluxo, processo encerrado e post sem processo';
end $$;
rollback;
