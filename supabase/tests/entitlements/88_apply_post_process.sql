-- supabase/tests/entitlements/88_apply_post_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- apply_post_process (migration 20260919000004). Cobre:
-- 88.0 happy path a partir do meio: anteriores ignoradas, inicial ativa, evento
-- 88.1 template editado depois do dialogo -> template_changed
-- 88.2 overrides invalidos: chave estranha, ordem anterior a inicial, responsavel alheio
-- 88.3 post ja em fluxo -> post_in_workflow; post com processo vigente -> post_has_active_process
-- 88.4 template de outra conta -> template_not_found; template vazio -> template_empty
-- 88.5 invalid_start_ordem: fora da sequencia, negativa e nula
-- 88.6 modo data_entrega sem etapa aprovacao_cliente na sequencia -> erro
--
-- IMPORTANTE. template_fingerprint e SECURITY INVOKER (Decisao 11) e o
-- argumento e avaliado no contexto do CHAMADOR. Sob 'set local role
-- authenticated' e sem et_grant_hosted_parity, ler workflow_templates levanta
-- 'permission denied' no banco local do CLI (ver _helpers.sql). Por isso todo
-- bloco calcula o fingerprint numa variavel ANTES de impersonar.

create or replace function pg_temp.et_ap_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out tmpl bigint, out membro bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into membros (user_id, conta_id, nome) values (usr, ws, 'Designer') returning id into membro;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso aprovado', 'aprovado_cliente') returning id into post;
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo) values (usr, ws, 'Modelo', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
    jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos'),
    -- A etapa 2 nasce com responsavel no template para o 88.0 provar que o
    -- override {"responsavel_id": null} LIMPA (ausencia da chave herdaria).
    jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente', 'responsavel_id', membro)
  ), 'padrao') returning id into tmpl;
end $$;

-- 88.0
begin;
do $$
declare e record; v_res jsonb; v_proc bigint; v_n int; v_status text; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, e.tmpl, v_fp, 1, jsonb_build_object(
    '1', jsonb_build_object('responsavel_id', e.membro, 'prazo_efetivo', '2026-09-15T02:59:59.000Z'),
    '2', jsonb_build_object('prazo_efetivo', '2026-09-18T02:59:59.000Z', 'responsavel_id', null)));
  execute 'reset role';

  v_proc := (v_res ->> 'process_id')::bigint;
  assert (v_res ->> 'etapa_atual')::int = 1 and (v_res ->> 'revisao')::int = 1, 'ponteiro e revisao iniciais';
  perform 1 from post_processes where id = v_proc and estado = 'ativo' and template_id = e.tmpl
    and template_nome = 'Modelo' and modo_prazo = 'padrao' and origem_workflow_id is null;
  assert found, 'processo criado a partir do template';
  perform 1 from post_processes where id = v_proc and assinatura = post_process_assinatura(v_proc);
  assert found, 'assinatura gravada bate com a reconstruida';

  select count(*) into v_n from post_process_steps where process_id = v_proc;
  assert v_n = 3, format('tres etapas, obtidas %s', v_n);
  perform 1 from post_process_steps where process_id = v_proc and ordem = 0 and estado = 'ignorado' and iniciado_em is null;
  assert found, 'etapa anterior a inicial fica ignorada';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 1 and estado = 'ativo'
    and responsavel_id = e.membro and prazo_efetivo = timestamptz '2026-09-15T02:59:59.000Z' and iniciado_em is not null;
  assert found, 'etapa inicial ativa com responsavel e prazo do override';
  perform 1 from post_process_steps where process_id = v_proc and ordem = 2 and estado = 'pendente'
    and tipo = 'aprovacao_cliente' and prazo_efetivo = timestamptz '2026-09-18T02:59:59.000Z'
    and responsavel_id is null;
  assert found, 'etapa futura pendente com o prazo enviado e responsavel limpo pelo override nulo';

  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', 'aplicar processo nao altera status do post';
  select count(*) into v_n from post_process_events where process_id = v_proc and evento = 'aplicado';
  assert v_n = 1, 'um evento aplicado';
  raise notice 'PASS 88.0 aplicar template no meio da sequencia';
end $$;
rollback;

-- 88.1
begin;
do $$
declare e record; v_fp text; v_raised boolean := false; v_n int;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  update workflow_templates set etapas = etapas || jsonb_build_array(
    jsonb_build_object('nome', 'Extra', 'prazo_dias', 1, 'tipo_prazo', 'corridos')) where id = e.tmpl;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'template editado deve levantar template_changed';
  select count(*) into v_n from post_processes;
  assert v_n = 0, 'nada criado';
  raise notice 'PASS 88.1 template_changed';
end $$;
rollback;

-- 88.2
begin;
do $$
declare e record; g record; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  select * into g from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z', 'nome', 'Hack')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave nome no override deve ser rejeitada';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 1, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z'),
      '1', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'override de etapa anterior a inicial deve ser rejeitado';

  -- fix round 1 (F2): chave fora do range de integer e chave com zero a
  -- esquerda sao ambas invalid_step_overrides, nao erro cru de cast.
  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '999999999999999999999', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave de override fora do range de integer deve ser rejeitada';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '01', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_step_overrides', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'chave de override com zero a esquerda deve ser rejeitada';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z', 'responsavel_id', g.membro)));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'membro_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'responsavel de outra conta deve levantar membro_not_found';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'start_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'etapa inicial sem prazo_efetivo deve ser rejeitada';
  execute 'reset role';
  raise notice 'PASS 88.2 validacao de p_step_overrides';
end $$;
rollback;

-- 88.3
begin;
do $$
declare e record; v_wf bigint; v_raised boolean := false; v_fp text;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (e.usr, e.ws, e.cli, 'WF', 'ativo') returning id into v_wf;
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = v_wf where id = e.post;
  perform set_config('app.allow_post_move', 'off', true);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_in_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post em fluxo deve levantar post_in_workflow';

  -- post_a0_sync_cliente (post_move_requires_rpc) exige a GUC ligada para
  -- qualquer UPDATE direto que mude workflow_id, inclusive limpar para null;
  -- sem isso este UPDATE do fixture (nao da RPC) levanta post_move_requires_rpc.
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = null where id = e.post;
  perform set_config('app.allow_post_move', 'off', true);
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao');
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'post com execucao vigente deve levantar post_has_active_process';
  raise notice 'PASS 88.3 pre-condicoes do post';
end $$;
rollback;

-- 88.4
begin;
do $$
declare e record; g record; v_vazio bigint; v_raised boolean := false;
begin
  select * into e from pg_temp.et_ap_env();
  select * into g from pg_temp.et_ap_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, g.tmpl, 'qualquer', 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'template de outra conta deve levantar template_not_found';
  execute 'reset role';

  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Vazio', '[]'::jsonb)
    returning id into v_vazio;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_vazio, '', 0, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_empty', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'template sem etapas deve levantar template_empty';
  raise notice 'PASS 88.4 template invalido';
end $$;
rollback;

-- 88.4b (fix round 1, F1): etapas do template fora do formato exigido.
-- workflow_templates.etapas e jsonb livre, sem CHECK -- um prazo_dias
-- fracionario ou um tipo fora do dominio precisam ser rejeitados por
-- apply_post_process com template_invalid, antes de qualquer INSERT, em vez
-- de estourar erro cru no cast (22P02) ou no CHECK do INSERT (23514).
begin;
do $$
declare e record; v_tmpl bigint; v_fp text; v_raised boolean := false;
begin
  select * into e from pg_temp.et_ap_env();

  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Fracionado', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'prazo_dias', 2.5, 'tipo_prazo', 'corridos')
  )) returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_invalid', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'prazo_dias fracionario deve levantar template_invalid';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';

  v_raised := false;
  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'TipoInvalido', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'tipo', 'x')
  )) returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'template_invalid', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'tipo fora do dominio deve levantar template_invalid';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado em nenhum dos dois casos';
  raise notice 'PASS 88.4b template com etapas malformadas';
end $$;
rollback;

-- 88.5
begin;
do $$
declare e record; v_fp text; v_raised boolean;
begin
  select * into e from pg_temp.et_ap_env();
  v_fp := template_fingerprint(e.tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- o template da fixture tem tres etapas, ordens 0, 1 e 2. A checagem de
  -- p_start_ordem vem ANTES da validacao de p_step_overrides, entao null nos
  -- overrides nao interfere.
  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, 3, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'ordem inicial fora da sequencia deve levantar invalid_start_ordem';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, -1, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'ordem inicial negativa deve levantar invalid_start_ordem';

  v_raised := false;
  begin
    perform apply_post_process(e.post, e.tmpl, v_fp, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_start_ordem', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'ordem inicial nula deve levantar invalid_start_ordem';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';
  raise notice 'PASS 88.5 invalid_start_ordem';
end $$;
rollback;

-- 88.6
begin;
do $$
declare e record; v_sem bigint; v_com bigint; v_fp text; v_raised boolean := false;
begin
  select * into e from pg_temp.et_ap_env();

  -- Template em modo data_entrega SEM nenhuma etapa aprovacao_cliente.
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega sem aprovacao', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'data_entrega') returning id into v_sem;
  -- Mesmo modo, com a aprovacao NO MEIO: comecar depois dela deixa a sequencia
  -- restante sem nenhuma aprovacao.
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega com aprovacao no meio', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'data_entrega') returning id into v_com;

  v_fp := template_fingerprint(v_sem);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_sem, v_fp, 0, jsonb_build_object(
      '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'data_entrega_requires_approval_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'data_entrega sem etapa de aprovacao deve ser rejeitado';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';

  -- A regra e relativa a p_start_ordem, nao ao template inteiro: aqui o
  -- template TEM uma etapa aprovacao_cliente (ordem 1), mas comecar em 2 deixa
  -- a sequencia restante sem nenhuma.
  v_fp := template_fingerprint(v_com);
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform apply_post_process(e.post, v_com, v_fp, 2, jsonb_build_object(
      '2', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'data_entrega_requires_approval_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'comecar depois da unica aprovacao tambem deve ser rejeitado';
  assert not exists (select 1 from post_processes), 'nada pode ter sido criado';

  -- Comecar NA propria etapa de aprovacao passa: a sequencia a partir dela a
  -- contem.
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform apply_post_process(e.post, v_com, v_fp, 1, jsonb_build_object(
    '1', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert exists (select 1 from post_processes where post_id = e.post), 'com aprovacao na sequencia, aplica';

  raise notice 'PASS 88.6a data_entrega_requires_approval_step';
end $$;
rollback;

begin;
do $$
declare e record; v_com bigint; v_fp text; v_res jsonb; v_n int;
begin
  select * into e from pg_temp.et_ap_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Entrega com aprovacao no fim', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente')
    ), 'data_entrega') returning id into v_com;
  v_fp := template_fingerprint(v_com);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_com, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'data_entrega com etapa de aprovacao aplica normalmente';
  select count(*) into v_n from post_process_steps where process_id = (v_res ->> 'process_id')::bigint;
  assert v_n = 2, format('duas etapas, obtidas %s', v_n);
  perform 1 from post_processes where id = (v_res ->> 'process_id')::bigint and modo_prazo = 'data_entrega';
  assert found, 'modo_prazo do template vai para o processo';
  raise notice 'PASS 88.6b data_entrega com etapa de aprovacao';
end $$;
rollback;

-- 88.6c: os demais modos ignoram a regra. O template da fixture e 'padrao' e
-- tem etapa de aprovacao; aqui um 'padrao' SEM nenhuma aprovacao_cliente
-- precisa aplicar sem erro, provando que a regra e so do data_entrega.
begin;
do $$
declare e record; v_tmpl bigint; v_fp text; v_res jsonb;
begin
  select * into e from pg_temp.et_ap_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (e.usr, e.ws, 'Padrao sem aprovacao', jsonb_build_array(
      jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
      jsonb_build_object('nome', 'Design', 'prazo_dias', 3, 'tipo_prazo', 'corridos')
    ), 'padrao') returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'modo padrao sem aprovacao aplica normalmente';

  -- data_fixa tambem ignora a regra.
  update workflow_templates set modo_prazo = 'data_fixa' where id = v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  delete from post_processes where post_id = e.post;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := apply_post_process(e.post, v_tmpl, v_fp, 0, jsonb_build_object(
    '0', jsonb_build_object('prazo_efetivo', '2026-09-15T02:59:59.000Z')));
  execute 'reset role';
  assert (v_res ->> 'ok')::boolean, 'modo data_fixa sem aprovacao aplica normalmente';
  raise notice 'PASS 88.6c outros modos ignoram a regra';
end $$;
rollback;
