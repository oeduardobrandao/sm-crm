\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- attach_post_closing_process (migration 20260919000007). Cobre:
-- 91.0 happy path: encerra com motivo vinculado, anexa com ordem =
--      (maior ordem do fluxo antes) + 1, sem tocar o post, e confere o
--      retorno inteiro conforme a tabela de Interfaces
-- 91.1 limite do fluxo respeitado -> plan_limit_exceeded e nada muda
-- 91.2 fluxo de outro cliente, fluxo arquivado e revisao velha
-- 91.3 attach_posts_to_flow continua barrado para o mesmo post (guard da fase 1)
-- 91.4 post ja em fluxo -> post_already_in_flow; processo encerrado ->
--      process_already_closed; post sem processo nenhum -> process_not_found
-- 91.5 fronteira do limite: atual + 1 = limite vincula com sucesso; atual =
--      limite continua recusando o proximo vinculo
-- 91.6 fluxo de outra conta -> workflow_not_found; post de outra conta ->
--      post_not_found
-- 91.7 post com processo vigente ja dentro de um fluxo (estado so alcancavel
--      contornando o trigger de post_processes) -> move_posts_to_existing_flow
--      e move_posts_to_new_flow caem no mesmo guard que barra
--      attach_posts_to_flow em 91.3 (criterio 12.16)
-- 91.8 fluxo com status nulo (UPDATE direto, workflows.status e nullable) ->
--      workflow_not_active, processo continua vigente (Minor 1 da review final)

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
declare
  e record; v_res jsonb; v_status text; v_wf bigint; v_ordem integer;
  v_baseline_post bigint; v_baseline_ordem integer;
begin
  select * into e from pg_temp.et_at_env();
  -- Post ja no fluxo antes do vinculo, com ordem conhecida, para que a
  -- assercao de ordem do post anexado seja discriminante (um fluxo vazio
  -- daria ordem 0 tanto no calculo certo quanto num que ignorasse o maximo
  -- anterior).
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo)
    values (e.wf, e.ws, e.cli, 'ja no fluxo antes') returning id into v_baseline_post;
  select ordem into v_baseline_ordem from workflow_posts where id = v_baseline_post;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := attach_post_closing_process(e.post, e.wf, 1);
  execute 'reset role';
  assert v_res ->> 'estado' = 'encerrado' and v_res ->> 'motivo_encerramento' = 'vinculado', 'encerrado com motivo vinculado';
  -- Retorno inteiro, conforme a tabela de Interfaces do plano.
  assert (v_res ->> 'ok')::boolean = true, 'ok true no retorno';
  assert (v_res ->> 'process_id')::bigint = e.proc, 'process_id no retorno';
  assert (v_res ->> 'post_id')::bigint = e.post, 'post_id no retorno';
  assert (v_res ->> 'workflow_id')::bigint = e.wf, 'workflow_id no retorno';
  assert (v_res ->> 'revisao')::integer = 2, 'revisao incrementada no retorno';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf = e.wf, 'post anexado ao fluxo';
  select ordem into v_ordem from workflow_posts where id = e.post;
  assert v_ordem = v_baseline_ordem + 1, 'ordem = (maior ordem do fluxo antes) + 1';
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

-- 91.5: mesma configuracao de plano do caso que estoura em 91.1
-- (max_posts_per_workflow = 1), mas aqui com limite = 2 para exercitar os
-- dois lados da fronteira na mesma suite: atual + 1 = limite deve vincular
-- com sucesso, e atual = limite deve continuar recusando o proximo vinculo
-- com o mesmo codigo do attach.
begin;
do $$
declare
  e record; v_wf bigint; v_post2 bigint; v_proc2 bigint; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  insert into workspace_plan_overrides (workspace_id, plan_id, resource_overrides)
    values (e.ws, (select plan_id from workspaces where id = e.ws), '{"max_posts_per_workflow": 2}'::jsonb);
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo) values (e.wf, e.ws, e.cli, 'ja no fluxo');

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform attach_post_closing_process(e.post, e.wf, 1);
  execute 'reset role';
  select workflow_id into v_wf from workflow_posts where id = e.post;
  assert v_wf = e.wf, 'atual (1) + 1 = limite (2) deve vincular com sucesso';

  -- Agora o fluxo esta com atual = limite (2 posts): o proximo vinculo deve
  -- ser recusado.
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (e.ws, e.cli, 'segundo avulso com processo', 'rascunho') returning id into v_post2;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (e.ws, v_post2, '0|Copy|padrao', 'ativo', 0) returning id into v_proc2;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(v_post2, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'atual = limite deve recusar o proximo vinculo';
  select workflow_id into v_wf from workflow_posts where id = v_post2;
  assert v_wf is null, 'post recusado continua avulso';
  perform 1 from post_processes where id = v_proc2 and estado = 'ativo';
  assert found, 'processo do post recusado nao e encerrado';
  raise notice 'PASS 91.5 fronteira do limite: atual+1=limite passa, atual=limite falha';
end $$;
rollback;

-- 91.6: fluxo e post resolvidos por id sozinho, sem passar pelo cliente
-- (diferente de 91.2, que usa um cliente da MESMA conta). Aqui o fluxo e o
-- post pertencem a uma conta inteiramente diferente, entao a resolucao cai
-- no filtro `conta_id = v_conta` de cada SELECT e responde *_not_found sem
-- vazar que o recurso existe em outro lugar.
begin;
do $$
declare
  e record;
  other_ws uuid; other_usr uuid; other_cli bigint; other_wf bigint; other_post bigint;
  v_raised boolean;
begin
  select * into e from pg_temp.et_at_env();

  other_ws := et_make_workspace('max');
  other_usr := gen_random_uuid();
  insert into auth.users (id) values (other_usr);
  insert into workspace_members (user_id, workspace_id, role) values (other_usr, other_ws, 'owner');
  update profiles set conta_id = other_ws, active_workspace_id = other_ws where id = other_usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (other_usr, other_ws, 'O', 'O', '#000') returning id into other_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (other_usr, other_ws, other_cli, 'De outra conta', 'ativo') returning id into other_wf;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (other_ws, other_cli, 'post de outra conta') returning id into other_post;

  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, other_wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fluxo de outra conta deve resolver para workflow_not_found';

  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(other_post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post de outra conta deve resolver para post_not_found';
  raise notice 'PASS 91.6 fluxo e post de outra conta resolvem para not_found';
end $$;
rollback;

-- 91.7: um post com processo vigente NUNCA fica com workflow_id preenchido
-- por nenhuma RPC (post_processes_requires_avulso so aceita criar/reabrir um
-- processo vigente para post avulso; post_a1_process_guard barra qualquer
-- UPDATE que preencha workflow_id enquanto o processo esta vigente). Para
-- provar que o guard tambem protege as duas RPCs de mover -- nao so
-- attach_posts_to_flow, que 91.3 ja cobre -- montamos aqui o estado que
-- nenhuma RPC alcanca sozinha: post ja com workflow_id preenchido (via
-- INSERT direto, que o guard nao intercepta -- ele e BEFORE UPDATE OF
-- workflow_id) e um processo vigente para ele (via INSERT direto com o
-- trigger post_processes_requires_avulso desligado so para esta linha,
-- mesmo padrao de estado "impossivel por DML" que 63_storage_autoclean.sql
-- usa para o caso postado/published_at nulo). Reabilitado o trigger, o guard
-- de attach continua de pe: qualquer UPDATE de workflow_id neste post,
-- inclusive o que move_posts_core faz por dentro das duas RPCs, cai nele.
begin;
do $$
declare
  ws uuid; usr uuid; cli bigint; tpl bigint;
  wf_src bigint; wf_tgt bigint;
  post bigint; proc bigint;
  v_raised boolean;
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_templates (user_id, conta_id, nome) values (usr, ws, 'TPL') returning id into tpl;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (usr, ws, cli, 'Origem', tpl, 'ativo') returning id into wf_src;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf_src, 0, 'Copy', 2, 'ativo');
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (usr, ws, cli, 'Destino', tpl, 'ativo') returning id into wf_tgt;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status) values (wf_tgt, 0, 'Copy', 2, 'ativo');

  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo)
    values (wf_src, ws, cli, 'com processo vigente') returning id into post;
  alter table post_processes disable trigger post_processes_requires_avulso;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao', 'ativo', 0) returning id into proc;
  alter table post_processes enable trigger post_processes_requires_avulso;

  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform move_posts_to_existing_flow(array[post], wf_src, wf_tgt);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'move_posts_to_existing_flow deve cair no guard de processo vigente';
  perform 1 from workflow_posts where id = post and workflow_id = wf_src;
  assert found, 'post recusado continua no fluxo de origem apos move_posts_to_existing_flow';

  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform move_posts_to_new_flow(array[post], wf_src, 'Split', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'move_posts_to_new_flow deve cair no guard de processo vigente';
  perform 1 from workflow_posts where id = post and workflow_id = wf_src;
  assert found, 'post recusado continua no fluxo de origem apos move_posts_to_new_flow';

  perform 1 from post_processes where id = proc and estado = 'ativo';
  assert found, 'o processo vigente nao e tocado por nenhuma tentativa recusada';
  raise notice 'PASS 91.7 move_posts_to_existing_flow e move_posts_to_new_flow barrados pelo guard de processo vigente';
end $$;
rollback;

-- 91.8: workflows.status e nullable (CHECK admite NULL). Com <> um fluxo de
-- status nulo passaria a checagem de ativo silenciosamente e receberia o
-- post; com IS DISTINCT FROM ele e tratado como inativo, mesmo raciocinio do
-- detach (20260919000003).
begin;
do $$
declare e record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_at_env();
  update workflows set status = null where id = e.wf;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_post_closing_process(e.post, e.wf, 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fluxo com status nulo deve ser tratado como inativo';
  perform 1 from post_processes where id = e.proc and estado = 'ativo';
  assert found, 'processo continua vigente quando o vinculo e recusado';
  raise notice 'PASS 91.8 status nulo do fluxo e tratado como inativo';
end $$;
rollback;
