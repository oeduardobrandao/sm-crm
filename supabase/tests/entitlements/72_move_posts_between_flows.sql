\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Mover posts entre fluxos: suite da 20260901110000_move_posts_between_flows
-- (move_posts_to_new_flow / move_posts_to_existing_flow + helpers privados).
-- Espelha o esqueleto do 70 (blocos do $$, et_make_workspace, jwt via
-- request.jwt.claims, assert, rollback por secao).
--
-- Concorrencia: como no 70, os deadlocks 40P01 que o protocolo de advisory
-- locks previne (':post_move' -> [':max_active_workflows_per_client' ->]
-- ':max_posts_per_workflow' -> locks de linha) exigem duas conexoes
-- simultaneas e nao sao reproduziveis numa suite psql de conexao unica. O que
-- E testavel em conexao unica -- posse, all-or-nothing, origem declarada,
-- fronteiras de limite, clone de etapas, remap de opcoes, arquivamento --
-- esta abaixo.
--
-- GUC app.allow_post_move: e transacional POR DESENHO (set_config(..., true)),
-- entao "nao vaza apos uma chamada bem-sucedida" nao e observavel aqui -- a
-- suite roda RPC e asserts NA MESMA transacao, onde a GUC ainda esta ativa. Em
-- producao cada RPC e sua propria transacao e a GUC morre no COMMIT. O que a
-- secao 6 pina: numa transacao SEM chamada de RPC, o PATCH direto de
-- workflow_id continua bloqueado por post_move_requires_rpc.

-- =====================================================================
-- 1. move_posts_to_new_flow: guardas e identificadores de erro
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_cli_other bigint;
  v_wf_a bigint; v_wf_b bigint;
  v_post_a1 bigint; v_post_b1 bigint; v_post_avulso bigint; v_post_other bigint;
  v_raised boolean;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_other, 'CO', 'CO', '#000') returning id into v_cli_other;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF-B', 'ativo') returning id into v_wf_b;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias)
    values (v_wf_a, 0, 'Unica', 1);
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_a, v_ws, 'A1') returning id into v_post_a1;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_b, v_ws, 'B1') returning id into v_post_b1;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws, v_cli, 'avulso') returning id into v_post_avulso;
  insert into workflow_posts (conta_id, cliente_id, titulo)
    values (v_ws_other, v_cli_other, 'other-ws') returning id into v_post_other;

  -- 1a. sem jwt -> workspace_not_found
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1], v_wf_a, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workspace_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'no jwt must raise workspace_not_found';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 1b. array vazio -> post_ids_required
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[]::bigint[], v_wf_a, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_ids_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'empty post_ids must raise post_ids_required';

  -- 1c. titulo vazio (so espacos) -> titulo_required
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1], v_wf_a, '   ', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'titulo_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'blank titulo must raise titulo_required';

  -- 1d. post de outra conta -> post_not_found (all-or-nothing)
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1, v_post_other], v_wf_a, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a post from another workspace must raise post_not_found';

  -- 1e. avulso no lote -> post_not_in_flow
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1, v_post_avulso], v_wf_a, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_in_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'an avulso in the batch must raise post_not_in_flow';

  -- 1f. lote de dois fluxos -> posts_in_multiple_flows
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1, v_post_b1], v_wf_a, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'posts_in_multiple_flows', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a batch spanning two flows must raise posts_in_multiple_flows';

  -- 1g. origem declarada diferente da real -> post_not_in_source_flow
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1], v_wf_b, 'X', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_not_in_source_flow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a declared source that does not hold the batch must raise post_not_in_source_flow';

  -- 1h. p_start_ordem inexistente na origem -> invalid_start_etapa
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_post_a1], v_wf_a, 'X', 42);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_etapa', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a start ordem missing from the source etapas must raise invalid_start_etapa';

  raise notice 'PASS 72.1 move_posts_to_new_flow guards';
end $$;
rollback;

-- =====================================================================
-- 2. move_posts_to_existing_flow: guardas do destino
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint; v_cli_other bigint;
  v_tpl bigint; v_tpl2 bigint;
  v_wf_src bigint; v_wf_arch bigint; v_wf_cli2 bigint; v_wf_tpl2 bigint;
  v_wf_null_a bigint; v_wf_null_b bigint; v_wf_other bigint;
  v_post bigint; v_post_null bigint;
  v_raised boolean;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C2', 'C2', '#000') returning id into v_cli2;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_other, 'CO', 'CO', '#000') returning id into v_cli_other;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL2') returning id into v_tpl2;

  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'SRC', v_tpl, 'ativo') returning id into v_wf_src;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'ARCH', v_tpl, 'arquivado') returning id into v_wf_arch;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli2, 'CLI2', v_tpl, 'ativo') returning id into v_wf_cli2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'TPL2', v_tpl2, 'ativo') returning id into v_wf_tpl2;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'NULL-A', 'ativo') returning id into v_wf_null_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'NULL-B', 'ativo') returning id into v_wf_null_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws_other, v_cli_other, 'OTHER', null, 'ativo') returning id into v_wf_other;

  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_src, v_ws, 'P') returning id into v_post;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_null_a, v_ws, 'PN') returning id into v_post_null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 2a. destino = origem -> target_is_source
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, v_wf_src);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'target_is_source', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'target = source must raise target_is_source';

  -- 2b. destino inexistente / de outra conta -> workflow_not_found
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, -1);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'bogus target must raise workflow_not_found';

  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, v_wf_other);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a target from another workspace must raise workflow_not_found';

  -- 2c. destino arquivado -> workflow_not_active
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, v_wf_arch);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'an archived target must raise workflow_not_active';

  -- 2d. destino de outro cliente -> workflow_different_client
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, v_wf_cli2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_different_client', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a target of another client must raise workflow_different_client';

  -- 2e. template diferente -> workflow_template_mismatch
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post], v_wf_src, v_wf_tpl2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_template_mismatch', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a target on another template must raise workflow_template_mismatch';

  -- 2f. origem SEM template: NULL-NULL nao e "mesmo modelo"
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_post_null], v_wf_null_a, v_wf_null_b);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_template_mismatch', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a templateless source must raise workflow_template_mismatch even against another templateless flow';

  raise notice 'PASS 72.2 move_posts_to_existing_flow target guards';
end $$;
rollback;

-- =====================================================================
-- 3. move_posts_to_new_flow: clone do fluxo + matriz de etapas + ordem dos
--    posts + evento 'criado' + arquivamento
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_tpl bigint;
  v_wf bigint; v_new_wf bigint;
  v_p1 bigint; v_p2 bigint; v_p3 bigint;
  v_result jsonb;
  v_wf_row workflows%rowtype;
  v_et record;
  v_ordem_p1 int; v_ordem_p3 int;
  v_count int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status,
                         etapa_atual, recorrente, modo_prazo)
    values (v_user, v_ws, v_cli, 'Origem', v_tpl, 'ativo', 1, true, 'data_fixa')
    returning id into v_wf;

  -- Origem: 4 etapas -- 0 concluida (com timestamps), 1 ativa (iniciada,
  -- tipo aprovacao_cliente), 2 e 3 pendentes; a 3 tem data_limite.
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status,
                               iniciado_em, concluido_em)
    values (v_wf, 0, 'Briefing', 1, 'uteis', 'padrao', 'concluido',
            now() - interval '4 days', now() - interval '3 days');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, status, iniciado_em)
    values (v_wf, 1, 'Aprovacao', 2, 'aprovacao_cliente', 'ativo', now() - interval '2 days');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, status)
    values (v_wf, 2, 'Design', 3, 'padrao', 'pendente');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, status, data_limite)
    values (v_wf, 3, 'Publicar', 1, 'padrao', 'pendente', date '2026-12-24');

  -- Posts com ordem fora de sequencia para pinar a preservacao da ordem
  -- RELATIVA da origem (nao a ordem por id).
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf, v_ws, 'P1', 5) returning id into v_p1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf, v_ws, 'P2', 2) returning id into v_p2;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf, v_ws, 'P3', 9) returning id into v_p3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- Move P1+P3 comecando na etapa 2 (ADIANTE da atual da origem: a etapa 1,
  -- ativa e nunca concluida na origem, vira concluida no clone e precisa de
  -- timestamps nao nulos). Titulo com espacos para pinar o trim.
  select move_posts_to_new_flow(array[v_p1, v_p3], v_wf, '  Origem (continuação)  ', 2)
    into v_result;
  assert (v_result->>'ok')::boolean and (v_result->>'moved')::int = 2,
    format('move must succeed, got %s', v_result);
  assert (v_result->'archived_workflow_ids') = '[]'::jsonb,
    format('partial move without flag must archive nothing, got %s', v_result);
  v_new_wf := (v_result->>'target_workflow_id')::bigint;

  -- Retorno enriquecido (20260901120000): a linha do fluxo novo e as etapas
  -- clonadas voltam no proprio resultado, para o CRM abrir o drawer do
  -- destino sem esperar o refetch do board.
  assert (v_result->'workflow'->>'id')::bigint = v_new_wf,
    format('result must carry the new workflow row, got %s', v_result->'workflow');
  assert v_result->'workflow'->>'titulo' = 'Origem (continuação)',
    'returned workflow row must reflect the trimmed titulo';
  assert jsonb_array_length(v_result->'etapas') = 4,
    format('result must carry the 4 cloned etapas, got %s', v_result->'etapas');
  assert v_result->'etapas'->0->>'ordem' = '0'
     and v_result->'etapas'->3->>'ordem' = '3',
    'returned etapas must be ordered by ordem';

  -- 3a. fluxo novo: heranca + escolhas fixadas em spec
  select * into v_wf_row from workflows where id = v_new_wf;
  assert v_wf_row.titulo = 'Origem (continuação)', format('titulo must be trimmed, got %L', v_wf_row.titulo);
  assert v_wf_row.status = 'ativo', 'new flow must be ativo';
  assert v_wf_row.etapa_atual = 2, format('etapa_atual must be the start ordem, got %s', v_wf_row.etapa_atual);
  assert v_wf_row.recorrente = false, 'new flow must NOT inherit recorrente';
  assert v_wf_row.template_id = v_tpl, 'new flow must inherit template_id';
  assert v_wf_row.cliente_id = v_cli, 'new flow must inherit cliente_id';
  assert v_wf_row.modo_prazo = 'data_fixa', 'new flow must inherit modo_prazo';
  assert v_wf_row.created_via = 'human', format('created_via must be human, got %s', v_wf_row.created_via);
  assert v_wf_row.user_id = v_user, 'user_id must be auth.uid()';

  -- 3b. matriz de etapas do clone
  select count(*) into v_count from workflow_etapas where workflow_id = v_new_wf;
  assert v_count = 4, format('clone must have the 4 source etapas, got %s', v_count);

  for v_et in
    select * from workflow_etapas where workflow_id = v_new_wf order by ordem
  loop
    if v_et.ordem < 2 then
      assert v_et.status = 'concluido', format('etapa %s must be concluido, got %s', v_et.ordem, v_et.status);
      assert v_et.iniciado_em is not null and v_et.concluido_em is not null,
        format('concluded clone etapa %s must carry non-null timestamps', v_et.ordem);
    elsif v_et.ordem = 2 then
      assert v_et.status = 'ativo', format('etapa 2 must be ativo, got %s', v_et.status);
      assert v_et.iniciado_em is not null, 'active clone etapa must have iniciado_em';
      assert v_et.concluido_em is null, 'active clone etapa must have concluido_em NULL';
    else
      assert v_et.status = 'pendente', format('etapa %s must be pendente, got %s', v_et.ordem, v_et.status);
      assert v_et.iniciado_em is null and v_et.concluido_em is null,
        format('pending clone etapa %s must carry no timestamps', v_et.ordem);
    end if;
    if v_et.ordem = 1 then
      assert v_et.tipo = 'aprovacao_cliente', 'etapa tipo must be cloned';
    end if;
    if v_et.ordem = 3 then
      assert v_et.data_limite = date '2026-12-24', 'data_limite must be copied as-is';
    end if;
  end loop;

  -- 3c. posts movidos: renumerados 0..N-1 preservando a ordem relativa da
  -- origem (P1 tinha ordem 5 < P3 com 9); P2 fica na origem intocado.
  select ordem into v_ordem_p1 from workflow_posts where id = v_p1;
  select ordem into v_ordem_p3 from workflow_posts where id = v_p3;
  assert v_ordem_p1 = 0 and v_ordem_p3 = 1,
    format('moved posts must keep source relative order, got p1=%s p3=%s', v_ordem_p1, v_ordem_p3);
  assert (select workflow_id from workflow_posts where id = v_p1) = v_new_wf, 'P1 must be in the new flow';
  assert (select workflow_id from workflow_posts where id = v_p2) = v_wf, 'P2 must stay in the source';
  assert (select ordem from workflow_posts where id = v_p2) = 2, 'P2 ordem must be untouched';

  -- 3d. evento 'criado' automatico (Trigger A) para o fluxo novo
  select count(*) into v_count
    from workflow_events where workflow_id = v_new_wf and event_type = 'criado';
  assert v_count = 1, format('new flow must get exactly one criado event, got %s', v_count);

  -- 3e. mover o ultimo post com a flag arquiva a origem (linha ja travada)
  select move_posts_to_new_flow(array[v_p2], v_wf, 'Resto', 0, true) into v_result;
  assert (v_result->'archived_workflow_ids') @> to_jsonb(array[v_wf]),
    format('emptied source must be archived, got %s', v_result);
  assert (select status from workflows where id = v_wf) = 'arquivado', 'source must be arquivado';

  raise notice 'PASS 72.3 move_posts_to_new_flow clone + etapa matrix + archive';
end $$;
rollback;

-- =====================================================================
-- 4. move_posts_to_existing_flow: append de ordem, pasta reparentada,
--    arquivamento parcial NAO arquiva
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_tpl bigint;
  v_wf_src bigint; v_wf_tgt bigint;
  v_a1 bigint; v_a2 bigint; v_a3 bigint; v_t1 bigint;
  v_result jsonb;
  v_ordem_a1 int; v_ordem_a2 int;
  v_tgt_folder bigint; v_post_folder_parent bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'SRC', v_tpl, 'ativo') returning id into v_wf_src;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'TGT', v_tpl, 'ativo') returning id into v_wf_tgt;

  -- Origem: A1 (ordem 7), A2 (ordem 3), A3 fica. Destino: T1 com ordem 4.
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf_src, v_ws, 'A1', 7) returning id into v_a1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf_src, v_ws, 'A2', 3) returning id into v_a2;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf_src, v_ws, 'A3', 1) returning id into v_a3;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem)
    values (v_wf_tgt, v_ws, 'T1', 4) returning id into v_t1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- Flag de arquivar ligada num move PARCIAL: a origem mantem A3 e NAO pode
  -- ser arquivada.
  select move_posts_to_existing_flow(array[v_a1, v_a2], v_wf_src, v_wf_tgt, true) into v_result;
  assert (v_result->>'ok')::boolean and (v_result->>'moved')::int = 2,
    format('move must succeed, got %s', v_result);
  assert (v_result->>'target_workflow_id')::bigint = v_wf_tgt, 'target id must round-trip';
  assert (v_result->'archived_workflow_ids') = '[]'::jsonb,
    format('a partial move must never archive the source, got %s', v_result);
  assert (select status from workflows where id = v_wf_src) = 'ativo', 'source must remain ativo';

  -- Append apos max(ordem)=4 do destino, preservando a ordem relativa da
  -- origem (A2 ordem 3 < A1 ordem 7 -> A2 chega antes).
  select ordem into v_ordem_a1 from workflow_posts where id = v_a1;
  select ordem into v_ordem_a2 from workflow_posts where id = v_a2;
  assert v_ordem_a2 = 5 and v_ordem_a1 = 6,
    format('moved posts must append after the target keeping source order, got a2=%s a1=%s',
      v_ordem_a2, v_ordem_a1);
  assert (select cliente_id from workflow_posts where id = v_a1) = v_cli, 'cliente_id must not change';

  -- Pasta do post reparentada para a pasta do fluxo destino (folder_sync_post)
  select id into v_tgt_folder from folders
   where conta_id = v_ws and source_type = 'workflow' and source_id = v_wf_tgt;
  select f.parent_id into v_post_folder_parent from folders f
   where f.conta_id = v_ws and f.source_type = 'post' and f.source_id = v_a1;
  assert v_post_folder_parent = v_tgt_folder,
    format('moved post folder must reparent to the target flow folder, got %s (target folder is %s)',
      v_post_folder_parent, v_tgt_folder);

  -- Move total do que restou, com flag -> agora sim arquiva.
  select move_posts_to_existing_flow(array[v_a3], v_wf_src, v_wf_tgt, true) into v_result;
  assert (v_result->'archived_workflow_ids') @> to_jsonb(array[v_wf_src]),
    format('emptied source must be archived, got %s', v_result);
  assert (select status from workflows where id = v_wf_src) = 'arquivado', 'source must be arquivado';

  raise notice 'PASS 72.4 move_posts_to_existing_flow append + folders + archive';
end $$;
rollback;

-- =====================================================================
-- 5. Limites de plano: fronteira exata passa, +1 estoura; estouro de
--    max_active_workflows_per_client nao deixa fluxo/etapas orfaos
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_tpl bigint;
  v_wf_a bigint; v_wf_b bigint;
  v_a1 bigint; v_a2 bigint; v_b1 bigint;
  v_raised boolean; v_result jsonb;
begin
  -- max_posts_per_workflow = 3: A tem 2 posts, B tem 1.
  v_ws := et_make_workspace('pro', '{"max_posts_per_workflow": 3}'::jsonb);
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'A', v_tpl, 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'B', v_tpl, 'ativo') returning id into v_wf_b;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wf_a, 0, 'E', 1);
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_a, v_ws, 'A1') returning id into v_a1;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_a, v_ws, 'A2') returning id into v_a2;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_b, v_ws, 'B1') returning id into v_b1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 5a. fronteira exata no destino existente: 1 + 2 = 3 = limite -> PASSA
  -- (mesma semantica do attach: cada post do lote, inserido um a um,
  -- satisfaria count < limite).
  select move_posts_to_existing_flow(array[v_a1, v_a2], v_wf_a, v_wf_b) into v_result;
  assert (v_result->>'moved')::int = 2, format('boundary move must pass, got %s', v_result);

  -- 5b. +1 estoura, all-or-nothing: A recebe B1 (fica 2/3 com A3 abaixo) e um
  -- lote de 2 vindo de B estoura 2 + 2 > 3 sem mover nada.
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf_a, v_ws, 'A3');
  select move_posts_to_existing_flow(array[v_b1], v_wf_b, v_wf_a) into v_result; -- A: 2/3
  v_raised := false;
  begin
    perform move_posts_to_existing_flow(array[v_a1, v_a2], v_wf_b, v_wf_a); -- 2 + 2 > 3
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'exceeding max_posts_per_workflow on the target must raise';
  assert (select workflow_id from workflow_posts where id = v_a1) = v_wf_b,
    'a rejected batch must not partially move any post';

  raise notice 'PASS 72.5a-b max_posts_per_workflow boundary + overflow (existing)';
end $$;
rollback;

begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint;
  v_p1 bigint; v_p2 bigint;
  v_raised boolean;
begin
  -- 5c/5d. Caminho new-flow: o fluxo destino nasce vazio, entao a guarda e
  -- N > limite. O override de plano e aplicado DEPOIS do setup (linha em
  -- workspace_plan_overrides), senao o proprio trg_limit_posts barraria a
  -- criacao dos 2 posts de teste.
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'A', 'ativo') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wf, 0, 'E', 1);
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'P1') returning id into v_p1;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'P2') returning id into v_p2;

  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (v_ws, '{"max_posts_per_workflow": 1}'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 5c. lote de 2 > limite 1 -> estoura ANTES do INSERT do fluxo (sem orfaos)
  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_p1, v_p2], v_wf, 'Novo', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_posts_per_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a new-flow batch above max_posts_per_workflow must raise';
  assert (select count(*) from workflows where conta_id = v_ws and titulo = 'Novo') = 0,
    'a rejected new-flow split must not leave an orphan workflow';

  -- 5d. fronteira: lote de 1 = limite 1 -> PASSA
  perform move_posts_to_new_flow(array[v_p1], v_wf, 'Novo', 0);
  assert (select count(*) from workflows where conta_id = v_ws and titulo = 'Novo') = 1,
    'boundary new-flow move (N = limit) must pass';

  raise notice 'PASS 72.5c-d max_posts_per_workflow boundary + overflow (new flow)';
end $$;
rollback;

begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf bigint; v_p1 bigint;
  v_raised boolean;
begin
  -- 5f. max_active_workflows_per_client = 1: a origem ativa ja ocupa o unico
  -- slot; o INSERT do fluxo novo estoura via trg_limit_workflows com o erro
  -- plan_limit_exceeded padrao, e nada fica orfao (rollback atomico do bloco).
  v_ws := et_make_workspace('pro', '{"max_active_workflows_per_client": 1}'::jsonb);
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'Unico', 'ativo') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wf, 0, 'E', 1);
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, v_ws, 'P1') returning id into v_p1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  v_raised := false;
  begin
    perform move_posts_to_new_flow(array[v_p1], v_wf, 'Segundo', 0);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'plan_limit_exceeded:max_active_workflows_per_client',
      format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'creating the split flow at the active-workflows cap must raise';
  assert (select count(*) from workflows where conta_id = v_ws and titulo = 'Segundo') = 0,
    'a rejected split must not leave an orphan workflow';
  assert (select count(*) from workflow_etapas e join workflows w on w.id = e.workflow_id
           where w.conta_id = v_ws) = 1,
    'a rejected split must not leave orphan etapas';
  assert (select workflow_id from workflow_posts where id = v_p1) = v_wf,
    'a rejected split must not move any post';

  raise notice 'PASS 72.5f max_active_workflows_per_client cap';
end $$;
rollback;

-- =====================================================================
-- 6. Guarda post_move_requires_rpc continua valendo para PATCH direto
--    (transacao SEM RPC -- ver nota de GUC no topo do arquivo)
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_wf_a bigint; v_wf_b bigint; v_post bigint;
  v_raised boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'A', 'ativo') returning id into v_wf_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'B', 'ativo') returning id into v_wf_b;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_a, v_ws, 'P') returning id into v_post;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    update workflow_posts set workflow_id = v_wf_b where id = v_post;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_move_requires_rpc', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'a direct workflow_id PATCH must still be rejected outside the RPCs';

  execute 'reset role';
  raise notice 'PASS 72.6 direct PATCH still blocked';
end $$;
rollback;

-- =====================================================================
-- 7. Remap de opcoes extras por fluxo (select, status, multiselect):
--    find-or-create por label no destino, valores dos movidos remapeados,
--    origem intacta, linhas envenenadas de outra conta ignoradas
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid(); v_user_o uuid := gen_random_uuid();
  v_cli bigint; v_cli_o bigint; v_tpl bigint; v_tpl_o bigint;
  v_wf_src bigint; v_wf_tgt bigint; v_wf_o bigint; v_new_wf bigint;
  v_def_sel bigint; v_def_multi bigint; v_def_stat bigint; v_def_o bigint;
  v_opt_sel uuid; v_opt_multi uuid; v_opt_stat uuid; v_opt_extra uuid;
  v_opt_tgt_urgente uuid; v_opt_poison_label uuid;
  v_p1 bigint; v_p2 bigint;
  v_result jsonb; v_val jsonb; v_new_opt uuid; v_count int;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user), (v_user_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user_o, v_ws_other, 'CO', 'CO', '#000') returning id into v_cli_o;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user, v_ws, 'TPL') returning id into v_tpl;
  insert into workflow_templates (user_id, conta_id, nome)
    values (v_user_o, v_ws_other, 'TPL-O') returning id into v_tpl_o;

  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'SRC', v_tpl, 'ativo') returning id into v_wf_src;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user, v_ws, v_cli, 'TGT', v_tpl, 'ativo') returning id into v_wf_tgt;
  insert into workflows (user_id, conta_id, cliente_id, titulo, template_id, status)
    values (v_user_o, v_ws_other, v_cli_o, 'WF-O', v_tpl_o, 'ativo') returning id into v_wf_o;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias)
    values (v_wf_src, 0, 'E', 1);

  insert into template_property_definitions (template_id, conta_id, name, type)
    values (v_tpl, v_ws, 'Prioridade', 'select') returning id into v_def_sel;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (v_tpl, v_ws, 'Tags', 'multiselect') returning id into v_def_multi;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (v_tpl, v_ws, 'Fase', 'status') returning id into v_def_stat;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (v_tpl_o, v_ws_other, 'Alheia', 'select') returning id into v_def_o;

  -- Opcoes extras da ORIGEM (uma por tipo + uma nao referenciada)
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    values (v_wf_src, v_def_sel, v_ws, 'Urgente', '#f00') returning option_id into v_opt_sel;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_src, v_def_multi, v_ws, 'Tag1') returning option_id into v_opt_multi;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_src, v_def_stat, v_ws, 'Custom') returning option_id into v_opt_stat;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_src, v_def_sel, v_ws, 'Extra') returning option_id into v_opt_extra;

  -- Destino ja tem 'Urgente' para a mesma definition (find deve reusar)
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_tgt, v_def_sel, v_ws, 'Urgente') returning option_id into v_opt_tgt_urgente;

  -- Linhas ENVENENADAS: (a) conta propria apontando definition de outra conta;
  -- (b) outra conta apontando o workflow de origem. Ambas devem ser ignoradas
  -- pelo helper (FKs globais + RLS so por conta_id tornam isso inseriveis).
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_src, v_def_o, v_ws, 'Poison-def') returning option_id into v_opt_poison_label;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf_src, v_def_sel, v_ws_other, 'Poison-conta');

  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_src, v_ws, 'P1') returning id into v_p1;
  insert into workflow_posts (workflow_id, conta_id, titulo)
    values (v_wf_src, v_ws, 'P2') returning id into v_p2;

  -- Valores: P1 usa as tres opcoes extras (select escalar, multiselect array
  -- com um elemento alheio ao remap, status escalar); P2 (que fica) usa a
  -- mesma opcao de select.
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_p1, v_def_sel, to_jsonb(v_opt_sel::text));
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_p1, v_def_multi, jsonb_build_array('template-opt-id', v_opt_multi::text));
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_p1, v_def_stat, to_jsonb(v_opt_stat::text));
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_p2, v_def_sel, to_jsonb(v_opt_sel::text));

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 7a. EXISTING: so as opcoes referenciadas pelos movidos sao materializadas;
  -- 'Urgente' ja existe no destino e e REUSADA (sem duplicata); 'Tag1' e
  -- 'Custom' sao criadas; 'Extra' (nao referenciada) NAO vai.
  select move_posts_to_existing_flow(array[v_p1], v_wf_src, v_wf_tgt) into v_result;
  assert (v_result->>'moved')::int = 1, format('move must succeed, got %s', v_result);

  select count(*) into v_count from workflow_select_options
   where workflow_id = v_wf_tgt and property_definition_id = v_def_sel and label = 'Urgente';
  assert v_count = 1, format('target must keep a single Urgente row (reused), got %s', v_count);

  select value into v_val from post_property_values
   where post_id = v_p1 and property_definition_id = v_def_sel;
  assert v_val = to_jsonb(v_opt_tgt_urgente::text),
    format('P1 select value must remap to the target existing option, got %s', v_val);

  select option_id into v_new_opt from workflow_select_options
   where workflow_id = v_wf_tgt and property_definition_id = v_def_multi and label = 'Tag1';
  assert v_new_opt is not null, 'Tag1 must be created on the target';
  select value into v_val from post_property_values
   where post_id = v_p1 and property_definition_id = v_def_multi;
  assert v_val = jsonb_build_array('template-opt-id', v_new_opt::text),
    format('multiselect must remap only the per-flow element, got %s', v_val);

  select option_id into v_new_opt from workflow_select_options
   where workflow_id = v_wf_tgt and property_definition_id = v_def_stat and label = 'Custom';
  assert v_new_opt is not null, 'Custom (status) must be created on the target';
  select value into v_val from post_property_values
   where post_id = v_p1 and property_definition_id = v_def_stat;
  assert v_val = to_jsonb(v_new_opt::text),
    format('status value must remap like select, got %s', v_val);

  assert not exists (select 1 from workflow_select_options
    where workflow_id = v_wf_tgt and label = 'Extra'),
    'an unreferenced source option must NOT be materialized on an existing target';
  assert not exists (select 1 from workflow_select_options
    where workflow_id = v_wf_tgt and label in ('Poison-def', 'Poison-conta')),
    'poisoned cross-tenant rows must be ignored by the remap helper';

  -- Origem intacta: linhas de opcao continuam la e P2 continua resolvendo.
  select count(*) into v_count from workflow_select_options where workflow_id = v_wf_src;
  assert v_count = 6, format('source option rows must be untouched, got %s', v_count);
  select value into v_val from post_property_values
   where post_id = v_p2 and property_definition_id = v_def_sel;
  assert v_val = to_jsonb(v_opt_sel::text), 'P2 (staying) must keep its original option value';

  -- 7b. NEW FLOW: copy_all -- toda opcao extra legitima da origem vai para o
  -- clone, referenciada ou nao; valores de P2 remapeiam para as novas.
  select move_posts_to_new_flow(array[v_p2], v_wf_src, 'Clone', 0) into v_result;
  v_new_wf := (v_result->>'target_workflow_id')::bigint;

  select count(*) into v_count from workflow_select_options where workflow_id = v_new_wf;
  assert v_count = 4, format('new flow must receive the 4 legit source options, got %s', v_count);
  assert exists (select 1 from workflow_select_options
    where workflow_id = v_new_wf and property_definition_id = v_def_sel and label = 'Extra'),
    'copy_all must materialize even unreferenced options on a new flow';
  assert not exists (select 1 from workflow_select_options
    where workflow_id = v_new_wf and label in ('Poison-def', 'Poison-conta')),
    'poisoned rows must be ignored on the new-flow path too';

  select option_id into v_new_opt from workflow_select_options
   where workflow_id = v_new_wf and property_definition_id = v_def_sel and label = 'Urgente';
  select value into v_val from post_property_values
   where post_id = v_p2 and property_definition_id = v_def_sel;
  assert v_val = to_jsonb(v_new_opt::text),
    format('P2 select value must remap to the clone option, got %s (clone opt %s)', v_val, v_new_opt);

  raise notice 'PASS 72.7 select-options remap (select/status/multiselect + tenant isolation)';
end $$;
rollback;
