-- supabase/tests/entitlements/89_transition_post_process.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- transition_post_process (migration 20260919000005). Cobre:
-- 89.0 avancar/voltar em etapa padrao: ponteiro, estados, prazo e revisao
-- 89.1 revisao velha -> process_changed sem efeito
-- 89.2 aprovacao com pendencia: aprovar_interno x sem_alterar, status esperado
-- 89.3 re-arm: post liberado com outra aprovacao adiante volta a rascunho
-- 89.4 concluir e reabrir preservam prazo vencido e nao tocam o post
-- 89.5 processo de outra conta -> process_not_found; reabrir de ativo -> process_not_concluded
-- 89.6 concluir na ultima etapa aprovacao_cliente: mesmo dialogo do avancar
-- 89.7 erros de argumento e de estado, agrupados num bloco so
-- 89.8 concluir com etapa pendente adiante -> pending_steps_remaining
-- 89.9 flag do plano desligada nao bloqueia avancar num processo existente (criterio 12.18)

create or replace function pg_temp.et_tr_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out proc bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status)
    values (ws, cli, 'Avulso', 'rascunho') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao' || chr(10) || '1|Aprovacao|aprovacao_cliente' || chr(10) || '2|Aprovacao final|aprovacao_cliente',
            'ativo', 0) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em, prazo_efetivo)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'ativo',
            timestamptz '2026-09-01 12:00:00+00', timestamptz '2026-09-03 02:59:59+00');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 1, 'Aprovacao', 'aprovacao_cliente', 1, 'uteis', 'pendente');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 2, 'Aprovacao final', 'aprovacao_cliente', 1, 'uteis', 'pendente');
end $$;

-- 89.0
begin;
do $$
declare e record; v_res jsonb; v_ini timestamptz; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  execute 'reset role';

  assert (v_res ->> 'etapa_atual')::int = 1 and (v_res ->> 'revisao')::int = 2, 'ponteiro e revisao apos avancar';
  -- Contrato de retorno completo (Interfaces do plano, I3 do task-5-review.md):
  -- so etapa_atual e revisao eram assertados antes deste fix round.
  assert (v_res ->> 'ok')::boolean, 'ok no contrato de retorno';
  assert v_res ->> 'command' = 'avancar', 'command no contrato de retorno ecoa o comando enviado';
  assert (v_res ->> 'process_id')::bigint = e.proc, 'process_id no contrato de retorno';
  assert (v_res ->> 'post_id')::bigint = e.post, 'post_id no contrato de retorno';
  assert v_res ->> 'estado' = 'ativo', 'estado no contrato de retorno';
  assert jsonb_array_length(v_res -> 'steps') = 3,
    format('steps com as tres etapas do processo, obtido %s', jsonb_array_length(v_res -> 'steps'));
  perform 1 from jsonb_array_elements(v_res -> 'steps') s
   where (s.value ->> 'ordem')::int = 1 and s.value ->> 'estado' = 'ativo'
     and (s.value ->> 'prazo_efetivo')::timestamptz = timestamptz '2026-09-08 02:59:59+00';
  assert found, 'steps traz ordem, estado e prazo_efetivo da etapa nova, nao so o formato';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'concluido' and concluido_em is not null;
  assert found, 'etapa anterior concluida';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1 and estado = 'ativo'
    and prazo_efetivo = timestamptz '2026-09-08 02:59:59+00' and iniciado_em is not null;
  assert found, 'etapa nova ativa com o prazo enviado';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'rascunho', 'avancar sobre etapa padrao nao toca o status';
  -- post_status e o nome exato da tabela de Interfaces do plano, e vale o
  -- status REAL do post depois do comando, nao o esperado que foi enviado: a
  -- comparacao e contra o que acabou de ser lido de workflow_posts. Aqui
  -- avancar sobre etapa padrao nao mexe no post, entao os dois sao 'rascunho'.
  assert v_res ->> 'post_status' = v_status,
    format('post_status do retorno deve espelhar workflow_posts.status, retorno %s banco %s',
           v_res ->> 'post_status', v_status);
  assert v_res ->> 'post_status' = 'rascunho', 'post_status no contrato de retorno';
  perform 1 from post_process_events where process_id = e.proc and evento = 'avancou';
  assert found, 'evento avancou';

  select iniciado_em into v_ini from post_process_steps where process_id = e.proc and ordem = 0;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 2, 'voltar');
  execute 'reset role';
  assert (v_res ->> 'etapa_atual')::int = 0 and (v_res ->> 'revisao')::int = 3, 'ponteiro e revisao apos voltar';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'ativo'
    and concluido_em is null and iniciado_em = v_ini and prazo_efetivo = timestamptz '2026-09-03 02:59:59+00';
  assert found, 'voltar preserva iniciado_em e o prazo vencido da etapa anterior';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1 and estado = 'pendente' and iniciado_em is null;
  assert found, 'a etapa abandonada volta a pendente';
  perform 1 from post_process_events where process_id = e.proc and evento = 'voltou';
  assert found, 'evento voltou';
  raise notice 'PASS 89.0 avancar e voltar';
end $$;
rollback;

-- 89.1
begin;
do $$
declare e record; v_raised boolean := false; v_rev int;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 99, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'revisao velha deve levantar process_changed';
  select revisao into v_rev from post_processes where id = e.proc;
  assert v_rev = 1, 'revisao nao pode ter sido incrementada';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'ativo';
  assert found, 'nenhuma etapa se moveu';
  raise notice 'PASS 89.1 controle otimista por revisao';
end $$;
rollback;

-- 89.2
begin;
do $$
declare e record; v_raised boolean := false; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  -- posiciona na etapa de aprovacao
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 0;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 1;
  update post_processes set etapa_atual = 1, revisao = 2 where id = e.proc;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 2, 'avancar', null, 'rascunho', timestamptz '2026-09-09 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'approval_choice_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'aprovacao com pendencia exige escolha';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'avancar', 'aprovar_interno', 'enviado_cliente', timestamptz '2026-09-09 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'status esperado divergente deve levantar post_changed';

  perform transition_post_process(e.proc, 2, 'avancar', 'aprovar_interno', 'rascunho', timestamptz '2026-09-09 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', format('aprovar_interno deve gravar aprovado_cliente, obtido %s', v_status);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'ativo';
  assert found, 'a proxima etapa ficou ativa';
  raise notice 'PASS 89.2 escolha na etapa de aprovacao';
end $$;
rollback;

-- 89.3
begin;
do $$
declare e record; v_status text;
begin
  select * into e from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 0;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 1;
  update post_processes set etapa_atual = 1, revisao = 2 where id = e.proc;
  update workflow_posts set status = 'aprovado_cliente' where id = e.post;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform transition_post_process(e.proc, 2, 'avancar', null, 'aprovado_cliente', timestamptz '2026-09-09 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'rascunho', format('com outra aprovacao adiante o post volta a rascunho, obtido %s', v_status);

  -- agendado nunca e reiniciado. A etapa adiante precisa ser
  -- aprovacao_cliente: e ela que faz v_tem_adiante ficar true na migration e
  -- exercitar de fato o guard "AND v_status = 'aprovado_cliente'" (fix round
  -- 1, I1 do task-5-review.md). Com tipo 'padrao' v_tem_adiante ficaria false
  -- e o ramo do re-arm nem seria alcancado -- o assert abaixo passaria sem
  -- provar nada sobre o guard.
  update workflow_posts set status = 'agendado' where id = e.post;
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem = 1;
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2, revisao = 3 where id = e.proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado)
    values (e.ws, e.proc, 3, 'Publicacao', 'aprovacao_cliente', 'pendente');
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform transition_post_process(e.proc, 3, 'avancar', null, 'agendado', timestamptz '2026-09-12 02:59:59+00');
  execute 'reset role';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'agendado', 'agendado nunca e reiniciado nem alterado';
  raise notice 'PASS 89.3 re-arm do proximo ciclo';
end $$;
rollback;

-- 89.4
begin;
do $$
declare e record; v_res jsonb; v_status text; v_ts timestamptz;
begin
  select * into e from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = timestamptz '2026-09-05 08:00:00+00',
    prazo_efetivo = timestamptz '2026-09-06 02:59:59+00' where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2 where id = e.proc;
  update workflow_posts set status = 'enviado_cliente' where id = e.post;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- a etapa ativa aqui e 'Aprovacao final' (aprovacao_cliente) e o post esta
  -- em enviado_cliente, que nao e liberado: concluir passa pelo mesmo dialogo
  -- do avancar, e 'sem_alterar' e a escolha que nao toca o post.
  v_res := transition_post_process(e.proc, 1, 'concluir', 'sem_alterar', 'enviado_cliente');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'processo concluido';
  assert (v_res ->> 'etapa_atual')::int = 2, 'o ponteiro fica na etapa que acabou de ser concluida';
  assert not (v_res ->> 'post_status_changed')::boolean, 'sem_alterar nao mexe no post';
  select concluido_em into v_ts from post_processes where id = e.proc;
  assert v_ts is not null, 'concluido_em carimbado pelo trigger';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'enviado_cliente', 'concluir nao aprova nem publica o post';

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 2, 'reabrir');
  execute 'reset role';
  assert v_res ->> 'estado' = 'ativo' and (v_res ->> 'etapa_atual')::int = 2, 'reabrir volta a ultima etapa';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'ativo'
    and iniciado_em = timestamptz '2026-09-05 08:00:00+00' and prazo_efetivo = timestamptz '2026-09-06 02:59:59+00';
  assert found, 'reabrir preserva iniciado_em e o prazo vencido';
  select concluido_em into v_ts from post_processes where id = e.proc;
  assert v_ts is null, 'reabrir limpa concluido_em';
  raise notice 'PASS 89.4 concluir e reabrir';
end $$;
rollback;

-- 89.5
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_tr_env();
  select * into g from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(g.proc, 1, 'concluir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'processo de outra conta deve levantar process_not_found';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'reabrir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_concluded', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'reabrir processo ativo deve levantar process_not_concluded';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'teleportar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_command', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'comando desconhecido deve levantar invalid_command';
  raise notice 'PASS 89.5 isolamento e comandos invalidos';
end $$;
rollback;

-- 89.6
begin;
do $$
declare e record; f record; v_res jsonb; v_status text; v_raised boolean;
begin
  select * into e from pg_temp.et_tr_env();
  -- posiciona na ultima etapa, que e aprovacao_cliente
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2, revisao = 2 where id = e.proc;

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'expected_post_status_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'concluir sobre etapa de aprovacao exige o status esperado do post';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir', null, 'rascunho');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'approval_choice_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'post nao liberado exige a escolha do dialogo tambem no concluir';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 2, 'concluir', 'aprovar_interno', 'enviado_cliente');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'status esperado divergente derruba concluir tambem';

  v_res := transition_post_process(e.proc, 2, 'concluir', 'aprovar_interno', 'rascunho');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'processo concluido';
  assert (v_res ->> 'etapa_atual')::int = 2, 'ponteiro na etapa concluida';
  assert (v_res ->> 'post_status_changed')::boolean, 'aprovar_interno mexeu no post';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'aprovado_cliente', format('aprovar_interno deve gravar aprovado_cliente, obtido %s', v_status);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'concluido';
  assert found, 'a etapa de aprovacao ficou concluida';

  -- concluir NAO re-arma. Depois da pre-checagem de pending_steps_remaining
  -- nao existe aprovacao PENDENTE adiante num concluir, entao o re-arm e
  -- provado impossivel: a ultima etapa, com o post ja liberado, sai concluida
  -- e o post fica exatamente como estava (avancar o teria voltado a rascunho).
  select * into f from pg_temp.et_tr_env();
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = f.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = f.proc and ordem = 2;
  update post_processes set etapa_atual = 2, revisao = 2 where id = f.proc;
  update workflow_posts set status = 'aprovado_cliente' where id = f.post;

  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(f.proc, 2, 'concluir', null, 'aprovado_cliente');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'a ultima etapa liberada conclui o processo';
  assert not (v_res ->> 'post_status_changed')::boolean, 'concluir com o post liberado nao mexe no post';
  select status into v_status from workflow_posts where id = f.post;
  assert v_status = 'aprovado_cliente', format('concluir nao re-arma o proximo ciclo, obtido %s', v_status);
  raise notice 'PASS 89.6 concluir na ultima etapa de aprovacao';
end $$;
rollback;

-- 89.7
begin;
do $$
declare e record; v_raised boolean;
begin
  select * into e from pg_temp.et_tr_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'avancar', 'talvez', 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_approval_choice', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'escolha desconhecida deve levantar invalid_approval_choice';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'voltar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_previous_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'na primeira etapa nao ha para onde voltar';

  v_raised := false;
  begin
    perform transition_post_process(e.proc, 1, 'avancar');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'next_deadline_required', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'proxima etapa com prazo relativo e sem prazo efetivo exige p_next_deadline';

  -- ultima etapa ativa: avancar nao tem para onde ir. A checagem de
  -- no_next_step vem ANTES da arvore de aprovacao, entao ela e que responde
  -- mesmo com a etapa ativa sendo aprovacao_cliente.
  update post_process_steps set estado = 'concluido', concluido_em = now() where process_id = e.proc and ordem in (0, 1);
  update post_process_steps set estado = 'ativo', iniciado_em = now() where process_id = e.proc and ordem = 2;
  update post_processes set etapa_atual = 2 where id = e.proc;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'no_next_step', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'sem proxima etapa pendente o comando e concluir, nao avancar';

  -- processo ja concluido: avancar, voltar e concluir sao recusados
  update post_processes set estado = 'concluido' where id = e.proc;
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_active', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo concluido nao avanca';
  raise notice 'PASS 89.7 erros de argumento e de estado';
end $$;
rollback;

-- 89.8
begin;
do $$
declare e record; v_res jsonb; v_raised boolean := false; v_estado text; v_rev int;
begin
  select * into e from pg_temp.et_tr_env();
  -- etapa ativa e a 0 ('Copy', padrao) e as etapas 1 e 2 continuam pendentes
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 1, 'concluir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'pending_steps_remaining', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'concluir no meio do processo deve levantar pending_steps_remaining';
  select estado, revisao into v_estado, v_rev from post_processes where id = e.proc;
  assert v_estado = 'ativo' and v_rev = 1, format('a recusa nao mexe no processo, obtido %s/%s', v_estado, v_rev);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 0 and estado = 'ativo';
  assert found, 'a etapa ativa continua ativa';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'pendente';
  assert found, 'a etapa pendente adiante continua pendente';

  -- so etapa PENDENTE bloqueia: com as duas adiante ignoradas, a etapa 0 passa
  -- a ser a ultima que importa e concluir e aceito.
  update post_process_steps set estado = 'ignorado' where process_id = e.proc and ordem in (1, 2);
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 1, 'concluir');
  execute 'reset role';
  assert v_res ->> 'estado' = 'concluido', 'na ultima etapa que importa concluir e aceito';
  assert (v_res ->> 'etapa_atual')::int = 0, 'o ponteiro fica na etapa que acabou de ser concluida';
  raise notice 'PASS 89.8 concluir exige a ultima etapa pendente';
end $$;
rollback;

-- 89.9. Criterio 12.18: a flag desliga so a CRIACAO de execucoes (apply,
-- detach), nao a operacao das que ja existem. transition_post_process nunca
-- consulta effective_plan_feature (post_process_require_editor tambem nao) --
-- um workspace que fez downgrade continua conseguindo avancar, voltar e
-- concluir os processos que ja tinha.
begin;
do $$
declare e record; v_res jsonb;
begin
  select * into e from pg_temp.et_tr_env();
  update plans set feature_post_processes = false
   where id = (select plan_id from workspaces where id = e.ws);

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := transition_post_process(e.proc, 1, 'avancar', null, 'rascunho', timestamptz '2026-09-08 02:59:59+00');
  execute 'reset role';

  assert (v_res ->> 'ok')::boolean, 'avancar continua funcionando com a flag do plano desligada';
  assert (v_res ->> 'etapa_atual')::int = 1, 'o ponteiro avanca normalmente';
  raise notice 'PASS 89.9 flag do plano desligada nao bloqueia transicao';
end $$;
rollback;
