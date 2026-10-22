-- supabase/tests/entitlements/100_post_process_rascunho_banner.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- resolve_post_process_rascunho_banner (migration 20261023000002). Cobre:
-- 100.1 reset volta aprovado_cliente a rascunho e grava a dispensa; sem reset
--       so grava; ciclo errado -> ciclo_changed; outra conta -> process_not_found;
--       papel sem entregas:editar -> permission_denied; grants
-- 100.2 post falha_publicacao com TikTok em falha: reset nao muda nada e o
--       post_targets fica intacto
-- 100.3 guardas do reset (processo ativo, passo ativo padrao, aprovacao
--       pendente adiante, uma vez por ciclo); dispensa segue leniente
-- 100.4 reset grava post_process_events com a mudanca de status

-- Processo: 0 Copy padrao (concluida), 1 Aprovacao aprovacao_cliente
-- (concluida em p_ciclo), 2 Design padrao (ativa), 3 Aprovacao final
-- aprovacao_cliente (pendente). Post aprovado_cliente.
create or replace function pg_temp.bn_env(
  out ws uuid, out usr uuid, out cli bigint, out post bigint, out proc bigint, out ciclo timestamptz)
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
    values (ws, cli, 'Avulso', 'aprovado_cliente') returning id into post;
  insert into post_processes (conta_id, post_id, assinatura, estado, etapa_atual, revisao)
    values (ws, post, '0|Copy|padrao' || chr(10) || '1|Aprovacao|aprovacao_cliente' || chr(10) || '2|Design|padrao'
            || chr(10) || '3|Aprovacao final|aprovacao_cliente',
            'ativo', 2, 3) returning id into proc;
  ciclo := timestamptz '2026-10-15 13:14:15.123456+00';
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, iniciado_em, concluido_em)
    values (ws, proc, 0, 'Copy', 'padrao', 'concluido',
            timestamptz '2026-10-10 10:00+00', timestamptz '2026-10-12 10:00+00');
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, iniciado_em, concluido_em)
    values (ws, proc, 1, 'Aprovacao', 'aprovacao_cliente', 'concluido',
            timestamptz '2026-10-12 10:00+00', ciclo);
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado, iniciado_em)
    values (ws, proc, 2, 'Design', 'padrao', 'ativo', ciclo);
  insert into post_process_steps (conta_id, process_id, ordem, nome, tipo, estado)
    values (ws, proc, 3, 'Aprovacao final', 'aprovacao_cliente', 'pendente');
end $$;

-- Executa p_sql como p_usr autenticado; devolve null ou a mensagem P0001.
create or replace function pg_temp.bn_try(p_usr uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    return null;
  exception when sqlstate 'P0001' then
    execute 'reset role';
    return sqlerrm;
  end;
end $$;

create or replace function pg_temp.bn_call(p_usr uuid, p_proc bigint, p_ciclo timestamptz, p_reset boolean)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := resolve_post_process_rascunho_banner(p_proc, p_ciclo, p_reset);
  execute 'reset role';
  return v;
end $$;

-- 100.1
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; v boolean; v_err text; r record; v_ver uuid; v_role uuid;
begin
  e := pg_temp.bn_env();

  -- ciclo errado (um microssegundo antes) e nulo
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo - interval '1 microsecond'));
  assert v_err = 'ciclo_changed', format('ciclo divergente: %s', v_err);
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, null, true)', e.proc));
  assert v_err = 'ciclo_changed', format('ciclo nulo: %s', v_err);
  select * into r from post_processes where id = e.proc;
  assert r.aviso_rascunho_dispensado_em is null, 'ciclo_changed nao dispensa';
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'ciclo_changed nao toca o post';

  -- outra conta
  o := pg_temp.bn_env();
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', o.proc, o.ciclo));
  assert v_err = 'process_not_found', format('outra conta: %s', v_err);
  assert (select status from workflow_posts where id = o.post) = 'aprovado_cliente', 'post alheio intacto';

  -- papel so de leitura em entregas
  v_ver := gen_random_uuid();
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (e.ws, 'So ver', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;
  v_err := pg_temp.bn_try(v_ver, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'permission_denied', format('papel so ver: %s', v_err);

  -- so dispensar
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, false);
  assert v = false, 'dispensar sem reset devolve false';
  select * into r from post_processes where id = e.proc;
  assert r.aviso_rascunho_dispensado_em is not null, 'dispensar grava aviso_rascunho_dispensado_em';
  assert r.revisao = 3, format('dispensar nao incrementa revisao: %s', r.revisao);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'dispensar nao toca o post';

  -- voltar para rascunho
  update post_processes set aviso_rascunho_dispensado_em = null where id = e.proc;
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, true);
  assert v = true, 'reset devolve true quando o post muda';
  assert (select status from workflow_posts where id = e.post) = 'rascunho', 'aprovado_cliente -> rascunho';
  select * into r from post_processes where id = e.proc;
  assert r.aviso_rascunho_dispensado_em is not null, 'reset tambem grava aviso_rascunho_dispensado_em';
  assert r.revisao = 3, format('reset nao incrementa revisao: %s', r.revisao);
  perform 1 from post_process_steps where process_id = e.proc and ordem = 2 and estado = 'ativo';
  assert found, 'etapa ativa nao se moveu';

  -- de novo com reset no mesmo ciclo: ja resolvido, ciclo_changed. Mesmo com o
  -- cliente tendo aprovado de novo no meio, o post nao volta.
  update workflow_posts set status = 'aprovado_cliente' where id = e.post;
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'ciclo_changed', format('segundo reset no ciclo: %s', v_err);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'segundo reset: aprovacao nova intacta';

  assert not has_function_privilege('anon',
    'public.resolve_post_process_rascunho_banner(bigint, timestamptz, boolean)', 'execute'), 'anon executa banner';
  assert has_function_privilege('authenticated',
    'public.resolve_post_process_rascunho_banner(bigint, timestamptz, boolean)', 'execute'), 'authenticated sem execute';
  raise notice 'PASS 100.1 banner do processo';
end $$;
rollback;

-- 100.2
begin;
select et_grant_hosted_parity();
do $$
declare e record; v boolean; r record;
begin
  e := pg_temp.bn_env();
  update workflow_posts set status = 'falha_publicacao' where id = e.post;
  insert into post_targets (conta_id, post_id, platform, status, error)
    values (e.ws, e.post, 'tiktok', 'falha', 'x')
    on conflict (post_id, platform) do update set status = 'falha', error = 'x';

  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, true);
  assert v = false, 'reset sobre falha_publicacao devolve false';
  assert (select status from workflow_posts where id = e.post) = 'falha_publicacao', 'falha_publicacao intacto';
  select * into r from post_targets where post_id = e.post and platform = 'tiktok';
  assert r.status = 'falha' and r.error = 'x', format('post_targets em falha preservado: %s %s', r.status, r.error);
  raise notice 'PASS 100.2 falha_publicacao intacto';
end $$;
rollback;

-- 100.3 guardas do reset (I1)
begin;
select et_grant_hosted_parity();
do $$
declare e record; v boolean; v_err text;
begin
  e := pg_temp.bn_env();

  -- processo fora de ativo (concluido; o trigger de concluido_em carimba)
  update post_processes set estado = 'concluido' where id = e.proc;
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'ciclo_changed', format('reset com processo concluido: %s', v_err);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'processo concluido: post intacto';
  assert (select aviso_rascunho_dispensado_em from post_processes where id = e.proc) is null, 'processo concluido: sem dispensa';
  -- dispensar segue leniente
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, false)', e.proc, e.ciclo));
  assert v_err is null, format('dispensar com processo concluido: %s', v_err);
  update post_processes set estado = 'ativo', aviso_rascunho_dispensado_em = null where id = e.proc;

  -- passo ativo e de aprovacao
  update post_process_steps set tipo = 'aprovacao_cliente' where process_id = e.proc and ordem = 2;
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'ciclo_changed', format('reset com passo ativo de aprovacao: %s', v_err);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'passo de aprovacao: post intacto';
  update post_process_steps set tipo = 'padrao' where process_id = e.proc and ordem = 2;

  -- sem aprovacao pendente adiante (o passo 3 foi ignorado)
  update post_process_steps set estado = 'ignorado' where process_id = e.proc and ordem = 3;
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'ciclo_changed', format('reset sem aprovacao adiante: %s', v_err);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'sem aprovacao adiante: post intacto';
  update post_process_steps set estado = 'pendente' where process_id = e.proc and ordem = 3;

  -- ja dispensado neste ciclo
  update post_processes set aviso_rascunho_dispensado_em = e.ciclo where id = e.proc;
  v_err := pg_temp.bn_try(e.usr, format(
    'select resolve_post_process_rascunho_banner(%s, %L::timestamptz, true)', e.proc, e.ciclo));
  assert v_err = 'ciclo_changed', format('reset ja dispensado: %s', v_err);
  assert (select status from workflow_posts where id = e.post) = 'aprovado_cliente', 'ja dispensado: post intacto';

  -- dispensa de um ciclo anterior nao bloqueia
  update post_processes set aviso_rascunho_dispensado_em = e.ciclo - interval '1 day' where id = e.proc;
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, true);
  assert v = true, 'reset com dispensa antiga muda o post';
  assert (select status from workflow_posts where id = e.post) = 'rascunho', 'reset com dispensa antiga: rascunho';
  raise notice 'PASS 100.3 guardas do reset';
end $$;
rollback;

-- 100.4 evento de historico do reset (M9)
begin;
select et_grant_hosted_parity();
do $$
declare e record; v boolean; r record; v_n int;
begin
  e := pg_temp.bn_env();
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, true);
  assert v = true, 'reset muda o post';
  select count(*) into v_n from post_process_events where process_id = e.proc;
  assert v_n = 1, format('um evento gravado: %s', v_n);
  select * into r from post_process_events where process_id = e.proc;
  assert r.evento = 'voltou_rascunho', format('evento: %s', r.evento);
  assert r.conta_id = e.ws and r.post_id = e.post, 'evento no tenant e post certos';
  assert r.actor_user_id = e.usr and r.actor_name = 'Dona' and r.origem = 'workspace_user',
    format('ator: %s %s %s', r.actor_user_id, r.actor_name, r.origem);
  assert r.antes ->> 'post_status' = 'aprovado_cliente', format('antes: %s', r.antes);
  assert (r.antes ->> 'etapa_ordem')::int = 2 and r.antes ->> 'etapa_nome' = 'Design', format('antes: %s', r.antes);
  assert r.depois ->> 'post_status' = 'rascunho', format('depois: %s', r.depois);
  assert r.depois ->> 'approval_choice' = 'voltar_rascunho', format('depois: %s', r.depois);
  assert (r.depois ->> 'etapa_ordem')::int = 2, format('depois: %s', r.depois);

  -- dispensa sem reset nao grava evento
  update post_processes set aviso_rascunho_dispensado_em = null where id = e.proc;
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, false);
  assert (select count(*) from post_process_events where process_id = e.proc) = 1, 'dispensar nao grava evento';

  -- reset que nao muda o post (falha_publicacao) nao grava evento
  e := pg_temp.bn_env();
  update workflow_posts set status = 'falha_publicacao' where id = e.post;
  v := pg_temp.bn_call(e.usr, e.proc, e.ciclo, true);
  assert v = false, 'reset sobre falha_publicacao nao muda';
  assert (select count(*) from post_process_events where process_id = e.proc) = 0, 'sem mudanca, sem evento';
  raise notice 'PASS 100.4 evento do reset';
end $$;
rollback;
