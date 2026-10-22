-- supabase/tests/entitlements/99_advance_workflow_from_approval.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- advance_workflow_from_approval + resolve_workflow_rascunho_banner
-- (migration 20261023000001). Cobre:
-- 99a.1 manter: posts intactos, etapa concluida, proxima ativa, ponteiro
-- 99a.2 aprovar_todos: so os pendentes viram aprovado_cliente
-- 99a.3 segunda chamada com a mesma etapa esperada -> etapa_changed
-- 99a.4 contagens divergentes -> posts_changed; sem contagens -> expected_counts_required
-- 99a.5 voltar_rascunho: agendado/postado/falha_publicacao intactos, post_targets em falha preservado
-- 99a.6 ultima etapa: voltar_rascunho -> invalid_approval_choice; manter conclui o fluxo
-- 99a.7 etapa padrao -> not_approval_etapa; outra conta -> workflow_not_found;
--       papel sem entregas:editar -> permission_denied; escolha invalida
-- 99a.8 banner: reset so de aprovado_cliente, dispensa sem reset, ciclo_changed
-- 99a.9 guardas do reset: fluxo ativo, etapa ativa padrao, aprovacao pendente
--       adiante, uma vez por ciclo (segundo reset falha); dispensa leniente
-- 99a.10 fluxo fora de ativo -> workflow_not_active

-- Fluxo: 0 Copy padrao (concluida), 1 Aprov copy aprovacao_cliente (ativa),
-- 2 Design padrao, 3 Aprov design aprovacao_cliente. Um post por status.
create or replace function pg_temp.aw_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint,
  out e0 bigint, out e1 bigint, out e2 bigint, out e3 bigint,
  out p_rasc bigint, out p_aint bigint, out p_env bigint,
  out p_acli bigint, out p_agen bigint, out p_falha bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual)
    values (usr, ws, cli, 'Mensal', 'ativo', 1) returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, concluido_em)
    values (wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido',
            timestamptz '2026-10-01 10:00+00', timestamptz '2026-10-02 10:00+00') returning id into e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (wf, 1, 'Aprov copy', 2, 'corridos', 'aprovacao_cliente', 'ativo',
            timestamptz '2026-10-02 10:00+00') returning id into e1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (wf, 2, 'Design', 2, 'corridos', 'padrao', 'pendente') returning id into e2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (wf, 3, 'Aprov design', 2, 'corridos', 'aprovacao_cliente', 'pendente') returning id into e3;

  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, ws, 'Rascunho', 0, 'rascunho') returning id into p_rasc;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, ws, 'Aprov interno', 1, 'aprovado_interno') returning id into p_aint;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, ws, 'Enviado', 2, 'enviado_cliente') returning id into p_env;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, ws, 'Aprov cliente', 3, 'aprovado_cliente') returning id into p_acli;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status, scheduled_at)
    values (wf, ws, 'Agendado', 4, 'agendado', timestamptz '2026-12-01 12:00+00') returning id into p_agen;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status, scheduled_at)
    values (wf, ws, 'Falha', 5, 'falha_publicacao', timestamptz '2026-10-20 12:00+00') returning id into p_falha;
  insert into post_targets (conta_id, post_id, platform, status, error)
    values (ws, p_falha, 'tiktok', 'falha', 'x')
    on conflict (post_id, platform) do update set status = 'falha', error = 'x';
end $$;

create or replace function pg_temp.aw_counts() returns jsonb language sql as $$
  select '{"rascunho":1,"aprovado_interno":1,"enviado_cliente":1,"aprovado_cliente":1,"agendado":1,"falha_publicacao":1}'::jsonb
$$;

-- Status de todos os posts do fluxo, para comparar antes/depois.
create or replace function pg_temp.aw_snapshot(p_wf bigint) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(id::text, status), '{}'::jsonb) from workflow_posts where workflow_id = p_wf
$$;

-- Executa p_sql como p_usr autenticado; devolve null ou a mensagem P0001.
create or replace function pg_temp.aw_try(p_usr uuid, p_sql text) returns text
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

create or replace function pg_temp.aw_call(
  p_usr uuid, p_wf bigint, p_etapa bigint, p_choice text, p_counts jsonb default null)
returns jsonb language plpgsql as $$
declare v_res jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := advance_workflow_from_approval(p_wf, p_etapa, p_choice, p_counts);
  execute 'reset role';
  return v_res;
end $$;

-- 99a.1 manter
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_res jsonb; v_before jsonb; r record;
begin
  e := pg_temp.aw_env();
  v_before := pg_temp.aw_snapshot(e.wf);
  v_res := pg_temp.aw_call(e.usr, e.wf, e.e1, 'manter');
  assert (v_res ->> 'ok')::boolean, 'ok no retorno';
  assert v_res ->> 'workflow_status' = 'ativo', format('workflow_status: %s', v_res);
  assert (v_res ->> 'etapa_atual')::int = 2, format('etapa_atual: %s', v_res);
  assert (v_res ->> 'posts_changed')::int = 0, format('posts_changed: %s', v_res);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'manter nao pode tocar posts';
  select * into r from workflow_etapas where id = e.e1;
  assert r.status = 'concluido' and r.concluido_em is not null, 'etapa 1 concluida com concluido_em';
  select * into r from workflow_etapas where id = e.e2;
  assert r.status = 'ativo' and r.iniciado_em is not null, 'etapa 2 ativa com iniciado_em';
  select * into r from workflow_etapas where id = e.e3;
  assert r.status = 'pendente', 'etapa 3 continua pendente';
  select * into r from workflows where id = e.wf;
  assert r.etapa_atual = 2 and r.status = 'ativo', format('workflow apos manter: %s %s', r.etapa_atual, r.status);
  raise notice 'PASS 99a.1 manter';
end $$;
rollback;

-- 99a.2 aprovar_todos + 99a.3 etapa_changed na segunda chamada
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_res jsonb; v_after jsonb; v_err text;
begin
  e := pg_temp.aw_env();
  v_res := pg_temp.aw_call(e.usr, e.wf, e.e1, 'aprovar_todos', pg_temp.aw_counts());
  assert (v_res ->> 'posts_changed')::int = 3, format('posts_changed: %s', v_res);
  assert (v_res ->> 'etapa_atual')::int = 2 and v_res ->> 'workflow_status' = 'ativo', format('retorno: %s', v_res);
  assert (select status from workflow_posts where id = e.p_rasc) = 'aprovado_cliente', 'rascunho -> aprovado_cliente';
  assert (select status from workflow_posts where id = e.p_aint) = 'aprovado_cliente', 'aprovado_interno -> aprovado_cliente';
  assert (select status from workflow_posts where id = e.p_env) = 'aprovado_cliente', 'enviado_cliente -> aprovado_cliente';
  assert (select status from workflow_posts where id = e.p_acli) = 'aprovado_cliente', 'aprovado_cliente intacto';
  assert (select status from workflow_posts where id = e.p_agen) = 'agendado', 'agendado intacto';
  assert (select status from workflow_posts where id = e.p_falha) = 'falha_publicacao', 'falha_publicacao intacto';
  assert (select status from workflow_etapas where id = e.e2) = 'ativo', 'etapa 2 ativa';
  raise notice 'PASS 99a.2 aprovar_todos';

  -- 99a.3
  v_after := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e1, 'manter', null));
  assert v_err = 'etapa_changed', format('segunda chamada: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_after, 'etapa_changed nao toca posts';
  assert (select status from workflow_etapas where id = e.e2) = 'ativo', 'etapa 2 continua ativa';
  assert (select status from workflow_etapas where id = e.e3) = 'pendente', 'etapa 3 continua pendente';
  assert (select etapa_atual from workflows where id = e.wf) = 2, 'ponteiro nao andou de novo';
  raise notice 'PASS 99a.3 etapa_changed';
end $$;
rollback;

-- 99a.4 contagens
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_before jsonb; v_err text;
begin
  e := pg_temp.aw_env();
  -- um post mudou depois que o dialogo contou
  update workflow_posts set status = 'enviado_cliente' where id = e.p_rasc;
  v_before := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e1, 'aprovar_todos', pg_temp.aw_counts()));
  assert v_err = 'posts_changed', format('contagem divergente: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'posts_changed nao toca posts';
  assert (select status from workflow_etapas where id = e.e1) = 'ativo', 'etapa 1 continua ativa';
  assert (select etapa_atual from workflows where id = e.wf) = 1, 'ponteiro parado';

  -- chave ausente num lado conta como 0: contagem certa sem a chave rascunho
  -- e com uma chave extra zerada passa da checagem (e e uma chamada valida).
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e1, 'voltar_rascunho',
    '{"aprovado_interno":1,"enviado_cliente":2,"aprovado_cliente":1,"agendado":1,"falha_publicacao":1,"postado":0}'));
  assert v_err is null, format('contagem com chaves ausentes/zeradas: %s', v_err);
  raise notice 'PASS 99a.4a posts_changed';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare e record; v_before jsonb; v_err text;
begin
  e := pg_temp.aw_env();
  v_before := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', e.wf, e.e1, 'aprovar_todos'));
  assert v_err = 'expected_counts_required', format('aprovar_todos sem contagens: %s', v_err);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', e.wf, e.e1, 'voltar_rascunho'));
  assert v_err = 'expected_counts_required', format('voltar_rascunho sem contagens: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'expected_counts_required nao toca posts';
  assert (select status from workflow_etapas where id = e.e1) = 'ativo', 'etapa 1 continua ativa';
  raise notice 'PASS 99a.4b expected_counts_required';
end $$;
rollback;

-- 99a.5 voltar_rascunho
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_res jsonb; r record;
begin
  e := pg_temp.aw_env();
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (e.wf, e.ws, 'Postado', 6, 'postado');
  v_res := pg_temp.aw_call(e.usr, e.wf, e.e1, 'voltar_rascunho',
    pg_temp.aw_counts() || '{"postado":1}'::jsonb);
  assert (v_res ->> 'posts_changed')::int = 3, format('posts_changed: %s', v_res);
  assert (select status from workflow_posts where id = e.p_rasc) = 'rascunho', 'rascunho intacto';
  assert (select status from workflow_posts where id = e.p_aint) = 'rascunho', 'aprovado_interno -> rascunho';
  assert (select status from workflow_posts where id = e.p_env) = 'rascunho', 'enviado_cliente -> rascunho';
  assert (select status from workflow_posts where id = e.p_acli) = 'rascunho', 'aprovado_cliente -> rascunho';
  assert (select status from workflow_posts where id = e.p_agen) = 'agendado', 'agendado intacto';
  assert (select status from workflow_posts where id = e.p_falha) = 'falha_publicacao', 'falha_publicacao intacto';
  assert (select count(*) from workflow_posts where workflow_id = e.wf and status = 'postado') = 1, 'postado intacto';
  select * into r from post_targets where post_id = e.p_falha and platform = 'tiktok';
  assert r.status = 'falha' and r.error = 'x', format('post_targets em falha preservado: %s %s', r.status, r.error);
  assert (select status from workflow_etapas where id = e.e2) = 'ativo', 'etapa 2 ativa';
  raise notice 'PASS 99a.5 voltar_rascunho';
end $$;
rollback;

-- 99a.6 ultima etapa
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_res jsonb; v_err text; r record;
begin
  e := pg_temp.aw_env();
  update workflow_etapas set status = 'concluido', concluido_em = now() where id in (e.e1, e.e2);
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = e.e3;
  update workflows set etapa_atual = 3 where id = e.wf;

  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e3, 'voltar_rascunho', pg_temp.aw_counts()));
  assert v_err = 'invalid_approval_choice', format('voltar_rascunho na ultima: %s', v_err);
  assert (select status from workflow_etapas where id = e.e3) = 'ativo', 'etapa 3 continua ativa';

  v_res := pg_temp.aw_call(e.usr, e.wf, e.e3, 'manter');
  assert v_res ->> 'workflow_status' = 'concluido', format('workflow_status: %s', v_res);
  assert (v_res ->> 'etapa_atual')::int = 3, format('etapa_atual: %s', v_res);
  assert (v_res ->> 'posts_changed')::int = 0, format('posts_changed: %s', v_res);
  select * into r from workflows where id = e.wf;
  assert r.status = 'concluido' and r.etapa_atual = 3, format('workflow: %s %s', r.status, r.etapa_atual);
  select * into r from workflow_etapas where id = e.e3;
  assert r.status = 'concluido' and r.concluido_em is not null, 'etapa 3 concluida';
  raise notice 'PASS 99a.6 ultima etapa';
end $$;
rollback;

-- 99a.7 erros de estado e acesso
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; v_err text; v_ver uuid; v_role uuid; v_before jsonb;
begin
  e := pg_temp.aw_env();
  v_before := pg_temp.aw_snapshot(e.wf);

  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', e.wf, e.e1, 'aprovar'));
  assert v_err = 'invalid_approval_choice', format('escolha invalida: %s', v_err);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, null)', e.wf, e.e1));
  assert v_err = 'invalid_approval_choice', format('escolha nula: %s', v_err);

  -- etapa ativa padrao
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = e.e1;
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = e.e2;
  update workflows set etapa_atual = 2 where id = e.wf;
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', e.wf, e.e2, 'manter'));
  assert v_err = 'not_approval_etapa', format('etapa padrao: %s', v_err);
  assert (select status from workflow_etapas where id = e.e2) = 'ativo', 'etapa padrao continua ativa';

  -- fluxo de outra conta
  o := pg_temp.aw_env();
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', o.wf, o.e1, 'manter'));
  assert v_err = 'workflow_not_found', format('outra conta: %s', v_err);
  assert (select status from workflow_etapas where id = o.e1) = 'ativo', 'fluxo alheio intacto';
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, null, true)', o.wf));
  assert v_err = 'workflow_not_found', format('banner outra conta: %s', v_err);

  -- papel so de leitura em entregas
  v_ver := gen_random_uuid();
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (e.ws, 'So ver', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;
  update workflow_etapas set status = 'pendente', iniciado_em = null where id = e.e2;
  update workflow_etapas set status = 'ativo', concluido_em = null where id = e.e1;
  update workflows set etapa_atual = 1 where id = e.wf;
  v_err := pg_temp.aw_try(v_ver, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e1, 'aprovar_todos', pg_temp.aw_counts()));
  assert v_err = 'permission_denied', format('papel so ver: %s', v_err);
  v_err := pg_temp.aw_try(v_ver, format(
    'select resolve_workflow_rascunho_banner(%s, null, true)', e.wf));
  assert v_err = 'permission_denied', format('banner papel so ver: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'permission_denied nao toca posts';
  assert (select status from workflow_etapas where id = e.e1) = 'ativo', 'etapa 1 continua ativa';

  -- anon nao executa
  assert not has_function_privilege('anon',
    'public.advance_workflow_from_approval(bigint, bigint, text, jsonb)', 'execute'), 'anon executa advance';
  assert not has_function_privilege('anon',
    'public.resolve_workflow_rascunho_banner(bigint, timestamptz, boolean)', 'execute'), 'anon executa banner';
  assert has_function_privilege('authenticated',
    'public.advance_workflow_from_approval(bigint, bigint, text, jsonb)', 'execute'), 'authenticated sem execute advance';
  raise notice 'PASS 99a.7 erros';
end $$;
rollback;

-- 99a.8 banner
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_ciclo timestamptz; v_n int; v_err text; v_disp timestamptz; v_before jsonb;
begin
  e := pg_temp.aw_env();
  perform pg_temp.aw_call(e.usr, e.wf, e.e1, 'manter');
  select concluido_em into v_ciclo from workflow_etapas where id = e.e1;
  assert v_ciclo is not null, 'etapa 1 concluida';

  -- ciclo errado
  v_before := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo - interval '1 second'));
  assert v_err = 'ciclo_changed', format('ciclo divergente: %s', v_err);
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, null, true)', e.wf));
  assert v_err = 'ciclo_changed', format('ciclo nulo: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'ciclo_changed nao toca posts';
  assert (select aviso_rascunho_dispensado_em from workflows where id = e.wf) is null, 'ciclo_changed nao dispensa';

  -- so dispensar
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_n := resolve_workflow_rascunho_banner(e.wf, v_ciclo, false);
  execute 'reset role';
  assert v_n = 0, format('dispensar devolve 0: %s', v_n);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'dispensar nao toca posts';
  select aviso_rascunho_dispensado_em into v_disp from workflows where id = e.wf;
  assert v_disp is not null, 'dispensar grava aviso_rascunho_dispensado_em';

  -- voltar para rascunho
  update workflows set aviso_rascunho_dispensado_em = null where id = e.wf;
  execute 'set local role authenticated';
  v_n := resolve_workflow_rascunho_banner(e.wf, v_ciclo, true);
  execute 'reset role';
  assert v_n = 1, format('reset devolve 1: %s', v_n);
  assert (select status from workflow_posts where id = e.p_acli) = 'rascunho', 'aprovado_cliente -> rascunho';
  assert (select status from workflow_posts where id = e.p_aint) = 'aprovado_interno', 'aprovado_interno intacto';
  assert (select status from workflow_posts where id = e.p_env) = 'enviado_cliente', 'enviado_cliente intacto';
  assert (select status from workflow_posts where id = e.p_agen) = 'agendado', 'agendado intacto';
  assert (select status from workflow_posts where id = e.p_falha) = 'falha_publicacao', 'falha_publicacao intacto';
  assert (select aviso_rascunho_dispensado_em from workflows where id = e.wf) is not null,
    'reset tambem grava aviso_rascunho_dispensado_em';
  raise notice 'PASS 99a.8 banner';
end $$;
rollback;

-- 99a.9 guardas do reset do banner (I1). Cada guarda falha com ciclo_changed
-- sem tocar post nem dispensa; a dispensa sem reset segue leniente.
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_ciclo timestamptz; v_n int; v_err text; v_before jsonb;
begin
  e := pg_temp.aw_env();
  perform pg_temp.aw_call(e.usr, e.wf, e.e1, 'manter');
  select concluido_em into v_ciclo from workflow_etapas where id = e.e1;
  v_before := pg_temp.aw_snapshot(e.wf);

  -- fluxo fora de ativo
  update workflows set status = 'arquivado' where id = e.wf;
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo));
  assert v_err = 'ciclo_changed', format('reset com fluxo arquivado: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'fluxo arquivado: posts intactos';
  assert (select aviso_rascunho_dispensado_em from workflows where id = e.wf) is null, 'fluxo arquivado: sem dispensa';
  -- dispensar segue leniente
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, false)', e.wf, v_ciclo));
  assert v_err is null, format('dispensar com fluxo arquivado: %s', v_err);
  update workflows set status = 'ativo', aviso_rascunho_dispensado_em = null where id = e.wf;

  -- etapa ativa e de aprovacao
  update workflow_etapas set tipo = 'aprovacao_cliente' where id = e.e2;
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo));
  assert v_err = 'ciclo_changed', format('reset com etapa ativa de aprovacao: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'etapa de aprovacao: posts intactos';
  update workflow_etapas set tipo = 'padrao' where id = e.e2;

  -- sem aprovacao pendente adiante
  update workflow_etapas set tipo = 'padrao' where id = e.e3;
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo));
  assert v_err = 'ciclo_changed', format('reset sem aprovacao adiante: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'sem aprovacao adiante: posts intactos';
  update workflow_etapas set tipo = 'aprovacao_cliente' where id = e.e3;

  -- ja dispensado neste ciclo
  update workflows set aviso_rascunho_dispensado_em = v_ciclo where id = e.wf;
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo));
  assert v_err = 'ciclo_changed', format('reset ja dispensado: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'ja dispensado: posts intactos';

  -- dispensa de um ciclo anterior nao bloqueia
  update workflows set aviso_rascunho_dispensado_em = v_ciclo - interval '1 day' where id = e.wf;
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_n := resolve_workflow_rascunho_banner(e.wf, v_ciclo, true);
  execute 'reset role';
  assert v_n = 1, format('reset com dispensa antiga: %s', v_n);
  assert (select aviso_rascunho_dispensado_em from workflows where id = e.wf) >= v_ciclo,
    'reset carimba a dispensa do ciclo';

  -- segundo reset no mesmo ciclo: cliente aprovou de novo no meio, nao volta
  update workflow_posts set status = 'aprovado_cliente' where id = e.p_acli;
  v_before := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select resolve_workflow_rascunho_banner(%s, %L::timestamptz, true)', e.wf, v_ciclo));
  assert v_err = 'ciclo_changed', format('segundo reset no ciclo: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'segundo reset: aprovacao nova intacta';
  raise notice 'PASS 99a.9 guardas do reset do banner';
end $$;
rollback;

-- 99a.10 fluxo fora de ativo -> workflow_not_active (M6)
begin;
select et_grant_hosted_parity();
do $$
declare e record; v_err text; v_before jsonb;
begin
  e := pg_temp.aw_env();
  update workflows set status = 'arquivado' where id = e.wf;
  v_before := pg_temp.aw_snapshot(e.wf);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L)', e.wf, e.e1, 'manter'));
  assert v_err = 'workflow_not_active', format('manter em fluxo arquivado: %s', v_err);
  v_err := pg_temp.aw_try(e.usr, format(
    'select advance_workflow_from_approval(%s, %s, %L, %L::jsonb)', e.wf, e.e1, 'aprovar_todos', pg_temp.aw_counts()));
  assert v_err = 'workflow_not_active', format('aprovar_todos em fluxo arquivado: %s', v_err);
  assert pg_temp.aw_snapshot(e.wf) = v_before, 'workflow_not_active nao toca posts';
  assert (select status from workflow_etapas where id = e.e1) = 'ativo', 'etapa 1 continua ativa';
  assert (select status from workflows where id = e.wf) = 'arquivado', 'fluxo continua arquivado';
  raise notice 'PASS 99a.10 workflow_not_active';
end $$;
rollback;
