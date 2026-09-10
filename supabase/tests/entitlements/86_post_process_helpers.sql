\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Endurecimento e helpers (migration 20260919000002). Cobre:
-- 86.0 concluido -> encerrado -> ativo limpa concluido_em (minor M1 da fase 1)
-- 86.1 indices de template_id e origem_workflow_id existem
-- 86.2 ACL das sequences: anon/authenticated sem USAGE, service_role com
-- 86.3 post_process_require_editor: sem workspace, sem permissao, com permissao
-- 86.4 post_process_log_event grava actor_name de profiles e origem system
-- 86.5 helpers nao sao executaveis por anon nem por authenticated
-- 86.6 post_process_assinatura reconstroi a assinatura das etapas

create or replace function pg_temp.et_hd_env(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona da conta' where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'avulso') returning id into post;
end $$;

-- 86.0
begin;
do $$
declare e record; v_proc bigint; v_ts timestamptz;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao') returning id into v_proc;
  update post_processes set estado = 'concluido' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is not null, 'concluir deve carimbar concluido_em';
  update post_processes set estado = 'encerrado', motivo_encerramento = 'vinculado' where id = v_proc;
  update post_processes set estado = 'ativo', motivo_encerramento = null where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is null, 'qualquer transicao para ativo deve limpar concluido_em, inclusive vinda de encerrado';
  raise notice 'PASS 86.0 concluido_em limpo em toda transicao para ativo';
end $$;
rollback;

-- 86.1
begin;
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname in ('idx_post_processes_template', 'idx_post_processes_origem');
  assert v_n = 2, format('esperados 2 indices de FK SET NULL, encontrados %s', v_n);
  raise notice 'PASS 86.1 indices das FKs SET NULL';
end $$;
rollback;

-- 86.2
begin;
do $$
declare s text;
begin
  foreach s in array array['post_processes_id_seq', 'post_process_steps_id_seq', 'post_process_events_id_seq'] loop
    assert not has_sequence_privilege('anon', 'public.' || s, 'usage'),
      format('anon nao pode ter USAGE em %s', s);
    assert not has_sequence_privilege('authenticated', 'public.' || s, 'usage'),
      format('authenticated nao pode ter USAGE em %s', s);
    assert has_sequence_privilege('service_role', 'public.' || s, 'usage'),
      format('service_role precisa de USAGE em %s', s);
  end loop;
  raise notice 'PASS 86.2 ACL das sequences';
end $$;
rollback;

-- 86.3
begin;
do $$
declare
  e record; v_sem uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
  v_role uuid; v_conta uuid; v_raised boolean := false;
begin
  select * into e from pg_temp.et_hd_env();
  insert into auth.users (id) values (v_sem), (v_ver);
  -- handle_new_user_workspace auto-provisiona um workspace dono para todo
  -- insert bare em auth.users (mesmo precedente de 53_set_financial_access.sql,
  -- linhas 133-144): sem isto v_sem sairia do insert acima ja com
  -- active_workspace_id apontando para um workspace novo, entao o caso "sem
  -- workspace ativo" precisa anular o ponteiro explicitamente.
  update profiles set active_workspace_id = null where id = v_sem;
  insert into workspace_roles (conta_id, nome, permissions) values (e.ws, 'so ve entregas', '{"entregas":"ver"}'::jsonb)
    returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;

  -- sem workspace ativo
  perform set_config('request.jwt.claims', json_build_object('sub', v_sem, 'role', 'authenticated')::text, true);
  begin
    perform post_process_require_editor();
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workspace_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'sem workspace ativo deve levantar workspace_not_found';

  -- membro com entregas=ver
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ver, 'role', 'authenticated')::text, true);
  begin
    perform post_process_require_editor();
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'permission_denied', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'entregas=ver deve levantar permission_denied';

  -- dono
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  v_conta := post_process_require_editor();
  assert v_conta = e.ws, 'dono deve receber a propria conta';
  raise notice 'PASS 86.3 post_process_require_editor';
end $$;
rollback;

-- 86.4
begin;
do $$
declare e record; v_proc bigint; v_ev record;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, '0|Copy|padrao') returning id into v_proc;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  perform post_process_log_event(e.ws, e.post, v_proc, 'aplicado', null, jsonb_build_object('etapa_atual', 0));
  select * into v_ev from post_process_events where process_id = v_proc;
  assert v_ev.actor_user_id = e.usr, 'evento deve guardar o autor';
  assert v_ev.actor_name = 'Dona da conta', format('actor_name deve vir de profiles.nome, obtido %s', v_ev.actor_name);
  assert v_ev.origem = 'workspace_user', 'com autor a origem e workspace_user';
  assert v_ev.depois ->> 'etapa_atual' = '0', 'depois deve ser preservado';

  perform set_config('request.jwt.claims', '', true);
  perform post_process_log_event(e.ws, e.post, v_proc, 'avancou', null, null);
  select * into v_ev from post_process_events where process_id = v_proc and evento = 'avancou';
  assert v_ev.origem = 'system' and v_ev.actor_user_id is null, 'sem autor a origem e system';
  raise notice 'PASS 86.4 post_process_log_event';
end $$;
rollback;

-- 86.5
begin;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.post_process_require_editor()',
    'public.post_process_log_event(uuid, bigint, bigint, text, jsonb, jsonb, text)',
    'public.post_process_assinatura(bigint)'
  ] loop
    assert not has_function_privilege('anon', fn, 'execute'), format('anon nao pode executar %s', fn);
    assert not has_function_privilege('authenticated', fn, 'execute'), format('authenticated nao pode executar %s', fn);
    -- Decisao 26: nem service_role. As RPCs SECURITY DEFINER chamam os helpers
    -- como o dono, que executa por ser dono, entao nenhum grant e necessario.
    assert not has_function_privilege('service_role', fn, 'execute'), format('service_role nao precisa executar %s', fn);
  end loop;
  raise notice 'PASS 86.5 helpers internos sem EXECUTE para ninguem alem do dono';
end $$;
rollback;

-- 86.6
begin;
do $$
declare e record; v_proc bigint;
begin
  select * into e from pg_temp.et_hd_env();
  insert into post_processes (conta_id, post_id, assinatura) values (e.ws, e.post, 'placeholder') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo) values
    (e.ws, v_proc, 1, 'Design', 'padrao'),
    (e.ws, v_proc, 0, 'Copy', 'padrao'),
    (e.ws, v_proc, 2, 'Aprovacao', 'aprovacao_cliente');
  assert post_process_assinatura(v_proc) = '0|Copy|padrao' || chr(10) || '1|Design|padrao' || chr(10) || '2|Aprovacao|aprovacao_cliente',
    format('assinatura inesperada: %s', post_process_assinatura(v_proc));
  raise notice 'PASS 86.6 post_process_assinatura';
end $$;
rollback;
