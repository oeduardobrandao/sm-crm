\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Fingerprints canonicos (migration 20260919000001). Cobre:
-- 85.0 formato exato do fluxo, com nulos, tipo default e timestamp UTC
-- 85.1 qualquer edicao de etapa muda o fingerprint, mesmo sem mover etapa_atual
-- 85.2 fluxo inexistente devolve NULL
-- 85.3 formato exato do template, com ordem base zero
-- 85.4 template inexistente devolve NULL; etapas vazio devolve ''
-- 85.5 RLS: SECURITY INVOKER. Membro de outra conta nao produz fingerprint
--      nenhum; membro da propria conta le o fingerprint completo por PostgREST
-- 85.6 etapa_atual NULL serializa como cabecalho vazio (etapa_atual=), nao
--      como 0; difere do mesmo fluxo com etapa_atual = 0

create or replace function pg_temp.et_fp_env(out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual)
    values (usr, ws, cli, 'Conteudo de setembro', 'ativo', 1) returning id into wf;
end $$;

-- 85.0
begin;
do $$
declare e record; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-09-01 12:00:00+00', null);
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (e.wf, 1, 'Design', 3, 'uteis', null, 'ativo', timestamptz '2026-09-03 09:30:00+00', date '2026-09-10');
  v_fp := workflow_fingerprint(e.wf);
  v_esperado := 'etapa_atual=1' || chr(10)
    || '0|Copy|padrao|concluido||2|corridos||2026-09-01T12:00:00.000Z' || chr(10)
    || '1|Design|padrao|ativo||3|uteis|2026-09-10|2026-09-03T09:30:00.000Z';
  assert v_fp = v_esperado, format('fingerprint inesperado:%s%s%sesperado:%s%s', chr(10), v_fp, chr(10), chr(10), v_esperado);
  raise notice 'PASS 85.0 formato do fingerprint de fluxo';
end $$;
rollback;

-- 85.1
begin;
do $$
declare e record; v_antes text; v_depois text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'ativo');
  v_antes := workflow_fingerprint(e.wf);
  update workflow_etapas set nome = 'Copywriting' where workflow_id = e.wf and ordem = 0;
  v_depois := workflow_fingerprint(e.wf);
  assert v_antes is distinct from v_depois, 'renomear etapa deve mudar o fingerprint';
  update workflow_etapas set nome = 'Copy' where workflow_id = e.wf and ordem = 0;
  assert workflow_fingerprint(e.wf) = v_antes, 'desfazer a edicao deve restaurar o fingerprint';
  update workflow_etapas set prazo_dias = 9 where workflow_id = e.wf and ordem = 0;
  assert workflow_fingerprint(e.wf) is distinct from v_antes, 'mudar prazo_dias deve mudar o fingerprint sem mover etapa_atual';
  raise notice 'PASS 85.1 edicao de etapa muda o fingerprint';
end $$;
rollback;

-- 85.2
begin;
do $$
begin
  assert workflow_fingerprint(-1::bigint) is null, 'fluxo inexistente deve devolver NULL';
  raise notice 'PASS 85.2 fluxo inexistente devolve NULL';
end $$;
rollback;

-- 85.3
begin;
do $$
declare e record; v_tmpl bigint; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Modelo', jsonb_build_array(
    jsonb_build_object('nome', 'Copy', 'prazo_dias', 2, 'tipo_prazo', 'corridos'),
    jsonb_build_object('nome', 'Aprovacao', 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'aprovacao_cliente')
  )) returning id into v_tmpl;
  v_fp := template_fingerprint(v_tmpl);
  v_esperado := '0|Copy|padrao|2|corridos' || chr(10) || '1|Aprovacao|aprovacao_cliente|1|uteis';
  assert v_fp = v_esperado, format('fingerprint de template inesperado: %s', v_fp);
  raise notice 'PASS 85.3 formato do fingerprint de template';
end $$;
rollback;

-- 85.4
begin;
do $$
declare e record; v_tmpl bigint;
begin
  select * into e from pg_temp.et_fp_env();
  assert template_fingerprint(-1::bigint) is null, 'template inexistente deve devolver NULL';
  insert into workflow_templates (user_id, conta_id, nome, etapas) values (e.usr, e.ws, 'Vazio', '[]'::jsonb) returning id into v_tmpl;
  assert template_fingerprint(v_tmpl) = '', 'template sem etapas deve devolver string vazia';
  raise notice 'PASS 85.4 template inexistente e template vazio';
end $$;
rollback;

-- 85.5
begin;
do $$
declare e record; f record; v_fp text; v_esperado text;
begin
  select * into e from pg_temp.et_fp_env();
  select * into f from pg_temp.et_fp_env();
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (e.wf, 0, 'Copy', 2, 'corridos', 'ativo');
  -- Paridade de grants para que 'set local role authenticated' exerça a RLS de
  -- workflows/workflow_etapas e nao o ACL do banco local (ver _helpers.sql).
  perform et_grant_hosted_parity();

  -- membro de OUTRA conta: workflows_select nao devolve a linha, a funcao cai
  -- no IF NOT FOUND e devolve NULL. Nao devolve 'etapa_atual=1': o cabecalho
  -- so existe quando o proprio fluxo foi lido.
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_fp := workflow_fingerprint(e.wf);
  execute 'reset role';
  assert v_fp is null,
    format('fluxo de outra conta nao pode produzir fingerprint, obtido: %s', v_fp);

  -- membro da PROPRIA conta: caminho publico da Decisao 11, o unico que prova
  -- que SECURITY INVOKER nao quebrou a chamada direta por PostgREST.
  v_esperado := 'etapa_atual=1' || chr(10) || '0|Copy|padrao|ativo||2|corridos||';
  perform set_config('request.jwt.claims', json_build_object('sub', e.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_fp := workflow_fingerprint(e.wf);
  execute 'reset role';
  assert v_fp = v_esperado,
    format('membro da conta deve obter o fingerprint completo, obtido: %s', v_fp);
  raise notice 'PASS 85.5 SECURITY INVOKER respeita a RLS e serve o caminho publico';
end $$;
rollback;

-- 85.6
begin;
do $$
declare e record; v_null text; v_zero text;
begin
  select * into e from pg_temp.et_fp_env();
  update workflows set etapa_atual = null where id = e.wf;
  v_null := workflow_fingerprint(e.wf);
  assert v_null = 'etapa_atual=',
    format('etapa_atual NULL deve serializar cabecalho vazio, obtido: %s', v_null);
  update workflows set etapa_atual = 0 where id = e.wf;
  v_zero := workflow_fingerprint(e.wf);
  assert v_zero = 'etapa_atual=0',
    format('etapa_atual 0 deve serializar como 0, obtido: %s', v_zero);
  assert v_null is distinct from v_zero,
    'etapa_atual NULL e etapa_atual 0 devem produzir fingerprints diferentes';
  raise notice 'PASS 85.6 etapa_atual NULL serializa vazio, distinto de 0';
end $$;
rollback;
