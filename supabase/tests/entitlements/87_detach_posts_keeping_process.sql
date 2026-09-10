-- supabase/tests/entitlements/87_detach_posts_keeping_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- detach_posts_keeping_process (migration 20260919000003). Cobre:
-- 87.0 happy path: dois posts, etapas herdadas/ativa/pendente, eventos, status intocado
-- 87.1 idempotencia: o mesmo request_id devolve o mesmo resultado sem novos efeitos
-- 87.2 fingerprint divergente -> workflow_changed e nada muda
-- 87.3 lote parcial (post de outra conta) -> post_not_found e rollback total
-- 87.4 permissao e flag: entregas=ver -> permission_denied; flag off -> feature_disabled
-- 87.5 arquivamento do fluxo esvaziado e prazos de etapas futuras
-- 87.6 erros de argumento e de pre-condicao, agrupados num bloco so
-- 87.7 responsavel herdado que nao resolve para membro da conta vira nulo
-- 87.8 mesmo request_id com outro lote, ou com a mesma selecao e outra flag de
--      arquivamento -> request_mismatch; entradas iguais -> replay
-- 87.9 ordem duplicada nas etapas da origem -> workflow_etapas_inconsistent
--
-- IMPORTANTE. workflow_fingerprint e SECURITY INVOKER (Decisao 11) e o
-- argumento e avaliado no contexto do CHAMADOR, nao dentro da RPC. Sob
-- 'set local role authenticated' e sem et_grant_hosted_parity, ler workflows
-- levanta 'permission denied' no banco local do CLI (ver _helpers.sql). Por
-- isso, todos os blocos calculam o fingerprint numa variavel ANTES de impersonar.

create or replace function pg_temp.et_dt_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint,
  out p1 bigint, out p2 bigint, out p3 bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual, modo_prazo)
    values (usr, ws, cli, 'Conteudo de setembro', 'ativo', 1, 'padrao') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-09-01 12:00:00+00');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (wf, 1, 'Design', 3, 'corridos', 'padrao', 'ativo', timestamptz '2026-09-03 09:00:00+00');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (wf, 2, 'Aprovacao', 1, 'uteis', 'aprovacao_cliente', 'pendente');
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 1', 'aprovado_interno') returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 2', 'rascunho') returning id into p2;
  insert into workflow_posts (workflow_id, conta_id, cliente_id, titulo, status)
    values (wf, ws, cli, 'Post 3', 'rascunho') returning id into p3;
end $$;

-- 87.0
begin;
do $$
declare
  e record; v_res jsonb; v_proc bigint; v_n int; v_status text; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := detach_posts_keeping_process(
    array[e.p1, e.p2], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  execute 'reset role';

  assert (v_res ->> 'ok')::boolean, 'retorno deve ser ok';
  assert (v_res ->> 'detached')::int = 2, format('detached esperado 2, obtido %s', v_res ->> 'detached');
  assert jsonb_array_length(v_res -> 'processes') = 2, 'dois processos criados';

  select count(*) into v_n from workflow_posts where id in (e.p1, e.p2) and workflow_id is null;
  assert v_n = 2, 'os dois posts ficam avulsos';
  select workflow_id into v_n from workflow_posts where id = e.p3;
  assert v_n = e.wf, 'o post nao pedido continua no fluxo';
  select status into v_status from workflow_posts where id = e.p1;
  assert v_status = 'aprovado_interno', 'desmembrar nao altera status do post';

  select id into v_proc from post_processes where post_id = e.p1;
  perform 1 from post_processes where id = v_proc and estado = 'ativo' and etapa_atual = 1
    and origem_workflow_id = e.wf and origem_descricao = 'Conteudo de setembro, etapa Design'
    and modo_prazo = 'padrao' and revisao = 1;
  assert found, 'processo criado na etapa ativa da origem com a descricao de origem';
  perform 1 from post_processes where id = v_proc and assinatura = post_process_assinatura(v_proc);
  assert found, 'assinatura gravada precisa bater com a reconstruida das etapas';

  select count(*) into v_n from post_process_steps where process_id = v_proc;
  assert v_n = 3, format('tres etapas em snapshot, obtidas %s', v_n);
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0
    and estado = 'herdado' and iniciado_em is null and origem_etapa_nome = 'Copy';
  assert found, 'etapa anterior fica herdada, sem conclusao ficticia';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1
    and estado = 'ativo' and prazo_efetivo = timestamptz '2026-09-06 02:59:59+00' and iniciado_em is not null;
  assert found, 'etapa ativa herda o prazo congelado e comeca agora';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 2
    and estado = 'pendente' and prazo_efetivo is null and tipo = 'aprovacao_cliente' and prazo_dias = 1;
  assert found, 'etapa futura fica pendente com prazo relativo preservado';

  select count(*) into v_n from post_process_events where process_id = v_proc and evento = 'desmembrado';
  assert v_n = 1, 'um evento desmembrado por post';
  perform 1 from post_process_events where process_id = v_proc and actor_user_id = e.usr and origem = 'workspace_user';
  assert found, 'evento carrega autor e origem';
  raise notice 'PASS 87.0 desmembrar mantendo etapas';
end $$;
rollback;

-- 87.1
begin;
do $$
declare e record; v_req uuid := gen_random_uuid(); v_a jsonb; v_b jsonb; v_n int; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_a := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  v_b := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  execute 'reset role';
  assert v_a = v_b, 'o mesmo request_id deve devolver o resultado guardado';
  select count(*) into v_n from post_processes where post_id = e.p1;
  assert v_n = 1, format('repetir o lote nao pode criar outro processo, encontrados %s', v_n);
  select count(*) into v_n from post_process_events where post_id = e.p1;
  assert v_n = 1, format('repetir o lote nao pode criar outro evento, encontrados %s', v_n);
  select count(*) into v_n from post_process_batch_requests where request_id = v_req and conta_id = e.ws;
  assert v_n = 1, 'um recibo por request_id';
  raise notice 'PASS 87.1 idempotencia do lote';
end $$;
rollback;

-- 87.2
begin;
do $$
declare e record; v_fp text; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  update workflow_etapas set nome = 'Design final' where workflow_id = e.wf and ordem = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fingerprint velho deve levantar workflow_changed';
  select count(*) into v_n from post_processes where post_id = e.p1;
  assert v_n = 0, 'nada pode ter sido criado';
  raise notice 'PASS 87.2 fingerprint divergente';
end $$;
rollback;

-- 87.3
begin;
do $$
declare e record; g record; v_raised boolean := false; v_n int; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1, g.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post de outra conta no lote deve levantar post_not_found';
  select count(*) into v_n from workflow_posts where id = e.p1 and workflow_id = e.wf;
  assert v_n = 1, 'o post da propria conta continua no fluxo (rollback total)';
  select count(*) into v_n from post_processes;
  assert v_n = 0, 'nenhum processo criado';
  raise notice 'PASS 87.3 lote parcial derruba tudo';
end $$;
rollback;

-- 87.4
begin;
do $$
declare
  e record; v_ver uuid := gen_random_uuid(); v_role uuid; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'ver', '{"entregas":"ver"}'::jsonb)
    returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'entregas=ver deve levantar permission_denied';

  v_raised := false;
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = e.ws);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'feature_disabled:feature_post_processes', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'flag desligada deve levantar feature_disabled antes do trigger';
  raise notice 'PASS 87.4 permissao e flag';
end $$;
rollback;

-- 87.5
begin;
do $$
declare e record; v_res jsonb; v_proc bigint; v_status text; v_prazo timestamptz; v_fp text;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := detach_posts_keeping_process(
    array[e.p1, e.p2, e.p3], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid(),
    jsonb_build_object('2', '2026-09-20T02:59:59.000Z'), true);
  execute 'reset role';

  select status into v_status from workflows where id = e.wf;
  assert v_status = 'arquivado', 'fluxo esvaziado deve ser arquivado quando pedido';
  assert v_res -> 'archived_workflow_ids' = to_jsonb(array[e.wf]), 'retorno lista o fluxo arquivado';
  select id into v_proc from post_processes where post_id = e.p1;
  select prazo_efetivo into v_prazo from post_process_steps where process_id = v_proc and ordem = 2;
  assert v_prazo = timestamptz '2026-09-20T02:59:59.000Z', 'etapa futura recebe o prazo enviado pelo CRM';
  raise notice 'PASS 87.5 arquivamento e prazos de etapas futuras';
end $$;
rollback;

-- 87.6
begin;
do $$
declare
  e record; g record; v_fp text; v_fp2 text; v_wf2 bigint;
  v_req uuid := gen_random_uuid(); v_raised boolean;
  v_prazo timestamptz := timestamptz '2026-09-06 02:59:59+00';
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  -- recibo de lote de OUTRA conta, para o caminho request_not_found
  insert into post_process_batch_requests (request_id, conta_id, resultado)
    values (v_req, g.ws, '{"ok":true}'::jsonb);
  -- segundo fluxo da propria conta, para o caminho post_not_in_source_flow
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual, modo_prazo)
    values (e.usr, e.ws, e.cli, 'Outro fluxo', 'ativo', 0, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'Copy', 2, 'corridos', 'padrao', 'ativo', timestamptz '2026-09-02 10:00:00+00');
  v_fp2 := workflow_fingerprint(v_wf2);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_id_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'p_request_id nulo deve levantar request_id_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, null, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'active_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'p_active_deadline nulo deve levantar active_deadline_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process('{}'::bigint[], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'lote vazio deve levantar post_ids_required';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, v_req);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'recibo de outra conta deve levantar request_not_found';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], g.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'fluxo de outra conta deve levantar workflow_not_found';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], v_wf2, v_fp2, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_in_source_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'post que nao esta no fluxo declarado deve levantar post_not_in_source_flow';

  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      jsonb_build_object('0', '2026-09-20T02:59:59.000Z'));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'prazo para etapa anterior a ativa deve levantar invalid_step_deadlines';

  -- Chave numerica que nao cabe em integer: passa na regex, e o cast cru
  -- levantaria 22003 sem codigo mapeavel.
  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      jsonb_build_object('999999999999999999999', '2026-09-20T02:59:59.000Z'));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave numerica fora do range de integer deve levantar invalid_step_deadlines';

  -- Valor JSON null: o cast nao levanta e a etapa ficaria sem prazo em silencio.
  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      '{"2": null}'::jsonb);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'valor JSON null no mapa de prazos deve levantar invalid_step_deadlines';

  -- Valor que nao e timestamptz.
  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      jsonb_build_object('2', 'ontem de manha'));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'valor nao-timestamptz deve levantar invalid_step_deadlines';

  -- Chave com zero a esquerda: nao canonica, some do INSERT (que le por
  -- e.ordem::text) e a etapa ficaria sem prazo em silencio.
  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid(),
      jsonb_build_object('07', '2026-09-20T02:59:59.000Z'));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_deadlines', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave com zero a esquerda deve levantar invalid_step_deadlines';

  -- NULL dentro do lote: antes era descartado em silencio e devolvia ok.
  v_raised := false;
  begin
    perform detach_posts_keeping_process(array[e.p1, null]::bigint[], e.wf, v_fp,
      v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'NULL dentro de p_post_ids deve levantar post_ids_required';
  execute 'reset role';

  -- fluxo arquivado: a checagem vem antes do fingerprint, entao v_fp serve
  update workflows set status = 'arquivado' where id = e.wf;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'fluxo arquivado deve levantar workflow_not_active';

  -- duas etapas ativas: o fingerprint muda com o status, entao recalcula antes
  update workflows set status = 'ativo' where id = e.wf;
  update workflow_etapas set status = 'ativo' where workflow_id = e.wf and ordem = 0;
  v_fp := workflow_fingerprint(e.wf);
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp, v_prazo, gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_etapas_inconsistent', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'duas etapas ativas devem levantar workflow_etapas_inconsistent';

  assert not exists (select 1 from post_processes), 'nenhum argumento invalido pode ter criado processo';
  raise notice 'PASS 87.6 erros de argumento e de pre-condicao';
end $$;
rollback;

-- 87.7
begin;
do $$
declare e record; g record; v_membro bigint; v_alheio bigint; v_fp text; v_proc bigint;
begin
  select * into e from pg_temp.et_dt_env();
  select * into g from pg_temp.et_dt_env();
  insert into membros (user_id, conta_id, nome) values (e.usr, e.ws, 'Designer') returning id into v_membro;
  insert into membros (user_id, conta_id, nome) values (g.usr, g.ws, 'Alheio') returning id into v_alheio;
  -- workflow_etapas.responsavel_id e FK SIMPLES para membros(id), sem checagem
  -- de tenant: dado velho ou importado pode apontar para membro de outra conta.
  -- post_process_steps.responsavel_id tem FK COMPOSTA com conta_id, entao a
  -- copia direta derrubaria o lote com foreign_key_violation cru (Decisao 17).
  update workflow_etapas set responsavel_id = v_membro where workflow_id = e.wf and ordem = 0;
  update workflow_etapas set responsavel_id = v_alheio where workflow_id = e.wf and ordem = 1;
  v_fp := workflow_fingerprint(e.wf);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  execute 'reset role';

  select id into v_proc from post_processes where post_id = e.p1;
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0 and responsavel_id = v_membro;
  assert found, 'responsavel da propria conta e preservado no snapshot';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1 and responsavel_id is null;
  assert found, 'responsavel de outra conta vira nulo em vez de derrubar o lote';
  raise notice 'PASS 87.7 responsavel herdado que nao resolve vira nulo';
end $$;
rollback;

-- 87.8
begin;
do $$
declare e record; v_req uuid := gen_random_uuid(); v_fp text;
        v_a jsonb; v_b jsonb; v_raised boolean := false;
        v_raised_flag boolean := false; v_n int;
begin
  select * into e from pg_temp.et_dt_env();
  v_fp := workflow_fingerprint(e.wf);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_a := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);

  -- Mesmo recibo, outro lote: o digest nao confere e a RPC recusa em vez de
  -- devolver o resultado do primeiro lote como se o segundo tivesse rodado.
  begin
    perform detach_posts_keeping_process(array[e.p2], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', v_req);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_mismatch', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;

  -- Mesmo recibo, MESMO lote, so a flag de arquivamento diferente. Ela e uma
  -- escolha do usuario no dialogo, entra no digest e tambem recusa (Decisao 28).
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', v_req, null, true);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'request_mismatch', format('wrong msg: %s', sqlerrm);
    v_raised_flag := true;
  end;

  -- Entradas iguais: replay puro, mesmo resultado e nenhum efeito novo.
  v_b := detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
    timestamptz '2026-09-06 02:59:59+00', v_req);
  execute 'reset role';

  assert v_raised, 'mesmo request_id com outro lote deve levantar request_mismatch';
  assert v_raised_flag, 'mesmo request_id com outra flag de arquivamento deve levantar request_mismatch';
  assert v_a = v_b, 'entradas iguais devolvem o resultado guardado';
  assert v_a ->> 'input_hash' is null, 'o digest fica no recibo, fora da resposta';
  select count(*) into v_n from post_processes where post_id in (e.p1, e.p2);
  assert v_n = 1, format('nenhum processo novo, encontrados %s', v_n);
  perform 1 from workflow_posts where id = e.p2 and workflow_id = e.wf;
  assert found, 'o post do lote divergente continua no fluxo';
  select count(*) into v_n from post_process_batch_requests where request_id = v_req and conta_id = e.ws;
  assert v_n = 1, 'um recibo por request_id';
  raise notice 'PASS 87.8 request_id reusado com entradas diferentes';
end $$;
rollback;

-- 87.9
begin;
do $$
declare e record; v_fp text; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_dt_env();
  -- workflow_etapas nao tem UNIQUE (workflow_id, ordem): duas abas que somam
  -- etapa ao mesmo tempo, ou uma importacao antiga, deixam ordem repetida. O
  -- fluxo continua com exatamente uma etapa ativa e o fingerprint tolera a
  -- repeticao, entao sem a checagem o lote so morreria no INSERT, com o
  -- 23505 cru de post_process_steps_ordem_uq.
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (e.wf, 2, 'Aprovacao (duplicada)', 1, 'uteis', 'padrao', 'pendente');
  v_fp := workflow_fingerprint(e.wf);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform detach_posts_keeping_process(array[e.p1], e.wf, v_fp,
      timestamptz '2026-09-06 02:59:59+00', gen_random_uuid());
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_etapas_inconsistent', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';

  assert v_raised, 'ordem duplicada nas etapas deve levantar workflow_etapas_inconsistent';
  select count(*) into v_n from post_processes where post_id = e.p1;
  assert v_n = 0, 'nada pode ter sido criado';
  select count(*) into v_n from workflow_posts where id = e.p1 and workflow_id = e.wf;
  assert v_n = 1, 'o post continua no fluxo';
  raise notice 'PASS 87.9 ordem duplicada nas etapas da origem';
end $$;
rollback;
