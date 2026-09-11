\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- update_post_process_step e remove_post_process (migration 20260919000006).
-- 90.0 editar responsavel e prazo de etapa ativa e pendente, com evento e revisao
-- 90.1 etapa concluida nao e editavel; responsavel de outra conta e rejeitado
-- 90.2 remover encerra, interrompe a etapa ativa e preserva status e historico
-- 90.3 remover libera nova aplicacao e reabrir um encerrado e rejeitado
-- 90.4 revisao velha e processo de outra conta
-- 90.5 advisory :post_move segurado ate o fim da transacao e remover duas vezes

create or replace function pg_temp.et_rm_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out proc bigint, out membro bigint)
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
    values (ws, cli, 'Avulso', 'enviado_cliente') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual)
    values (ws, post, '0|Copy|padrao' || chr(10) || '1|Design|padrao', 'ativo', 1) returning id into proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, concluido_em)
    values (ws, proc, 0, 'Copy', 'padrao', 2, 'corridos', 'concluido', now());
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado, iniciado_em)
    values (ws, proc, 1, 'Design', 'padrao', 3, 'corridos', 'ativo', now());
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, prazo_dias, tipo_prazo, estado)
    values (ws, proc, 2, 'Aprovacao', 'aprovacao_cliente', 1, 'uteis', 'pendente');
end $$;

-- 90.0
begin;
do $$
declare e record; v_res jsonb; v_ev record;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := update_post_process_step(e.proc, 1, 1, e.membro, timestamptz '2026-09-20 02:59:59+00');
  assert (v_res ->> 'revisao')::int = 2, 'editar incrementa a revisao';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1
    and responsavel_id = e.membro and prazo_efetivo = timestamptz '2026-09-20 02:59:59+00';
  assert found, 'etapa ativa recebe responsavel e prazo';

  v_res := update_post_process_step(e.proc, 2, 2, null, null);
  execute 'reset role';
  assert (v_res ->> 'revisao')::int = 3, 'segunda edicao incrementa de novo';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2
    and responsavel_id is null and prazo_efetivo is null;
  assert found, 'null limpa os campos da etapa pendente';

  select * into v_ev from post_process_events where process_id = e.proc and evento = 'etapa_editada' order by id limit 1;
  assert v_ev.antes ->> 'responsavel_id' is null and (v_ev.depois ->> 'responsavel_id')::bigint = e.membro,
    'evento etapa_editada guarda antes e depois';
  raise notice 'PASS 90.0 editar etapa';
end $$;
rollback;

-- 90.1
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  select * into g from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform update_post_process_step(e.proc, 1, 0, e.membro, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'step_not_editable', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'etapa concluida nao e editavel';

  v_raised := false;
  begin
    perform update_post_process_step(e.proc, 1, 1, g.membro, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'membro_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'responsavel de outra conta e rejeitado';

  v_raised := false;
  begin
    perform update_post_process_step(e.proc, 1, 9, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'step_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'ordem inexistente e step_not_found';
  raise notice 'PASS 90.1 validacao de edicao de etapa';
end $$;
rollback;

-- 90.2
begin;
do $$
declare e record; v_res jsonb; v_status text; v_n int;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := remove_post_process(e.proc, 1);
  execute 'reset role';
  assert v_res ->> 'estado' = 'encerrado' and v_res ->> 'motivo_encerramento' = 'removido', 'encerrado com motivo removido';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 1
    and estado = 'interrompido' and interrompido_em is not null;
  assert found, 'a etapa ativa vira interrompido com carimbo';
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'pendente';
  assert found, 'as futuras continuam pendentes';
  select status into v_status from workflow_posts where id = e.post;
  assert v_status = 'enviado_cliente', 'remover nao altera status do post';
  select count(*) into v_n from post_process_events where process_id = e.proc;
  assert v_n = 1, 'o historico do processo continua acessivel';
  raise notice 'PASS 90.2 remover encerra e preserva';
end $$;
rollback;

-- 90.3
begin;
do $$
declare e record; v_novo bigint; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform remove_post_process(e.proc, 1);
  execute 'reset role';

  -- o indice parcial libera: o post pode receber nova execucao
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao')
    returning id into v_novo;
  assert v_novo is not null, 'post volta a Sem processo e aceita nova execucao';

  -- um encerrado nunca volta a ativo por transition (nao esta concluido)
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform transition_post_process(e.proc, 2, 'reabrir');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_concluded', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'um processo encerrado nunca ressuscita, entao a etapa interrompida nunca volta a contar como aprovacao adiante';
  raise notice 'PASS 90.3 nova execucao e encerrado terminal';
end $$;
rollback;

-- 90.4
begin;
do $$
declare e record; g record; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  select * into g from pg_temp.et_rm_env();
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform remove_post_process(e.proc, 99);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_changed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'revisao velha deve levantar process_changed';

  v_raised := false;
  begin
    perform update_post_process_step(g.proc, 1, 1, null, null);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'processo de outra conta deve levantar process_not_found';
  perform 1 from post_processes where id = e.proc and estado = 'ativo';
  assert found, 'nada foi encerrado';
  raise notice 'PASS 90.4 revisao e isolamento';
end $$;
rollback;

-- 90.5
begin;
do $$
declare e record; f record; v_base int; v_n int; v_raised boolean := false;
begin
  select * into e from pg_temp.et_rm_env();
  -- Assercao RELATIVA de proposito: a fixture ja deixa advisory locks
  -- segurados, porque enforce_plan_count_limit toma um por chave de limite a
  -- cada INSERT contado (cliente, membro). O que se prova aqui e que a RPC
  -- acrescenta a chave ':post_move' da conta, e que ela fica segurada ate o
  -- fim da transacao. Se alguem tirar o advisory das duas RPCs, este bloco
  -- falha e a ordem de locks volta a ter o ciclo do cabecalho da migration.
  select count(*) into v_base from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();

  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform update_post_process_step(e.proc, 1, 1, null, null);
  execute 'reset role';
  select count(*) into v_n from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  assert v_n > v_base, 'update_post_process_step precisa tomar o advisory :post_move';

  -- Segunda conta, para que a chave ':post_move' dela tambem seja nova.
  select * into f from pg_temp.et_rm_env();
  select count(*) into v_base from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform remove_post_process(f.proc, 1);
  -- segunda remocao: o processo ja esta encerrado
  begin
    perform remove_post_process(f.proc, 2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'process_already_closed', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'remover um processo ja encerrado deve levantar process_already_closed';
  select count(*) into v_n from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  assert v_n > v_base, 'remove_post_process precisa tomar o advisory :post_move';
  raise notice 'PASS 90.5 advisory :post_move e process_already_closed';
end $$;
rollback;
