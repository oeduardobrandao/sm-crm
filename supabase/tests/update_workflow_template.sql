-- Valida supabase/migrations/20260925130002_template_propagation_preserve_overrides.sql
-- (update_workflow_template novo; propagate_template_to_workflows reduzido a backfill).
--
-- Regra (por campo, por etapa, casamento posicional):
--   template antigo X, novo X            -> mantem
--   template antigo X, novo Y, fluxo X   -> Y
--   template antigo X, novo Y, fluxo Z   -> mantem Z
--   sem etapa no template novo           -> etapa intocada
--   prazo = par (prazo_dias, tipo_prazo)
--
-- Casos:
--   (a) incidente 2026-09-24: so o responsavel muda; prazo customizado sobrevive
--   (b) nome herdado segue, nome customizado fica
--   (c) par de prazo: so tipo_prazo muda; herdado segue, prazo_dias customizado fica
--   (d) tipo: pendente herdado segue; ativo nunca recebe tipo
--   (e) normalizacao: tipo_prazo NULL no fluxo / ausente no template; responsavel "" = null
--   (f) parse defensivo do template antigo (2.5, "abc", etapas nao-array) nao levanta
--   (g) concluida intocada; fluxo maior que o template antigo mantem a etapa extra
--   (h) template encolhe: etapa alem do fim fica intocada
--   (i) reordenacao: valor customizado fica na posicao, herdados seguem o template
--   (j) backfill de etapa anexada com os valores novos
--   (k) eventos: 1 por fluxo tocado, alteracoes exatas, nenhum para fluxo 100% preservado,
--       nenhum ruido de trigger de linha
--   (l) tenancy: template de outro workspace = template_not_found; fluxo envenenado intocado
--   (m) validacao: template_invalid / invalid_responsavel
--   (n) modo_prazo so no template; workflows.modo_prazo e data_limite intocados
--   (o) evento transacional: falha ao gravar o evento faz a chamada levantar
--   (p) propagate_template_to_workflows antigo: so backfill, nunca sobrescreve
--   (q) limpar responsavel: template antigo A, novo sem responsavel_id (NULL);
--       herdado vira NULL com alteracoes para:null, customizado (B) fica
--   (r) etapas antigas com elemento nao-objeto na posicao 0: fica intocado,
--       posicao 1 segue o merge normal
--
-- A RPC faz set_config('app.suppress_workflow_events','1', true), que persiste pelo
-- resto da transacao de teste: toda chamada bem-sucedida e seguida de reset para '0'.
-- Chamadas que devem falhar passam por pg_temp.uwt_err, cujo bloco EXCEPTION reverte a
-- subtransacao (e a GUC) sozinho; por isso o teste confere o CODIGO do erro, nao
-- "nada foi gravado" (isso a semantica do EXCEPTION ja garante).
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;

create function pg_temp.uwt_err(p_tpl bigint, p_nome text, p_etapas jsonb, p_modo text)
returns text language plpgsql as $$
begin
  perform public.update_workflow_template(p_tpl, p_nome, p_etapas, p_modo);
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_ma bigint; v_mb bigint; v_mx bigint;
  v_tpl bigint;
  v_wf bigint; v_wf2 bigint; v_wf3 bigint;
  v_e0 bigint; v_e1 bigint; v_e2 bigint; v_e3 bigint; v_e4 bigint;
  v_err text;
  v_cnt int;
  v_meta jsonb;
  v_snap jsonb;
  r record;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws,  nome = 'Dona'  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2, nome = 'Outra' where id = v_other;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws,  v_owner, 'Cli',  'CL',  '#000') returning id into v_cli;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws2, v_other, 'Cli2', 'CL2', '#000') returning id into v_cli2;
  insert into membros (conta_id, user_id, nome) values (v_ws,  v_owner, 'Membro A') returning id into v_ma;
  insert into membros (conta_id, user_id, nome) values (v_ws,  v_owner, 'Membro B') returning id into v_mb;
  insert into membros (conta_id, user_id, nome) values (v_ws2, v_other, 'Membro X') returning id into v_mx;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------
  -- (a) incidente: template so troca o responsavel A -> B
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Posts', jsonb_build_array(
      jsonb_build_object('nome','Copy','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',v_ma,'tipo','padrao'),
      jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_ma,'tipo','padrao')
    ), 'padrao') returning id into v_tpl;

  -- fluxo herdado
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'A herdado', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status, iniciado_em)
    values (v_wf, 0, 'Copy', 1, 'corridos', v_ma, 'padrao', 'ativo', now()) returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 1, 'Design', 3, 'corridos', v_ma, 'padrao', 'pendente') returning id into v_e1;

  -- fluxo customizado: Copy com prazo 14; Design ja com responsavel B
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'A custom', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status, iniciado_em)
    values (v_wf2, 0, 'Copy', 14, 'corridos', v_ma, 'padrao', 'ativo', now()) returning id into v_e2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf2, 1, 'Design', 3, 'corridos', v_mb, 'padrao', 'pendente') returning id into v_e3;

  perform update_workflow_template(v_tpl, 'Posts', jsonb_build_array(
    jsonb_build_object('nome','Copy','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',v_mb,'tipo','padrao'),
    jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_mb,'tipo','padrao')
  ), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.responsavel_id = v_mb and r.prazo_dias = 1, '(a) herdado: responsavel segue o template';
  select * into r from workflow_etapas where id = v_e1;
  assert r.responsavel_id = v_mb, '(a) herdado pendente: responsavel segue o template';
  select * into r from workflow_etapas where id = v_e2;
  assert r.prazo_dias = 14 and r.tipo_prazo = 'corridos',
    format('(a) prazo customizado deve sobreviver, veio %s %s', r.prazo_dias, r.tipo_prazo);
  assert r.responsavel_id = v_mb, '(a) custom: responsavel herdado segue o template';
  select * into r from workflow_etapas where id = v_e3;
  assert r.responsavel_id = v_mb, '(a) Design ja tinha B: continua B';

  select etapas into v_snap from workflow_templates where id = v_tpl;
  assert (v_snap->0->>'responsavel_id')::bigint = v_mb, '(a) template salvo com o novo responsavel';

  -- (k) alteracoes exatas do fluxo customizado: so o responsavel da Copy
  select metadata into v_meta from workflow_events
    where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_meta is not null, '(k) fluxo customizado foi tocado: deve ter evento';
  assert (v_meta->>'etapas_atualizadas')::int = 1 and (v_meta->>'etapas_criadas')::int = 0,
    format('(k) contagens erradas: %s', v_meta);
  assert v_meta->'alteracoes' = jsonb_build_array(jsonb_build_object(
      'etapa_id', v_e2, 'ordem', 0, 'campo', 'responsavel_id', 'de', v_ma, 'para', v_mb)),
    format('(k) alteracoes inesperadas: %s', v_meta->'alteracoes');
  assert v_meta->>'template_nome' = 'Posts' and (v_meta->>'template_id')::bigint = v_tpl,
    '(k) template_id/template_nome no metadata';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf and event_type = 'template_propagado';
  assert v_cnt = 1, '(k) exatamente 1 evento por fluxo tocado';
  select count(*) into v_cnt from workflow_events
    where workflow_id in (v_wf, v_wf2)
      and event_type in ('etapa_editada','etapa_iniciada','etapa_concluida','etapa_revertida','fluxo_editado');
  assert v_cnt = 0, '(k) nenhum ruido de trigger de linha durante a propagacao';

  -- ---------------------------------------------------------------------
  -- (b) nome
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TB', '[{"nome":"N","prazo_dias":2,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'B1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'N', 2, 'uteis', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'B2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf2, 0, 'Custom', 2, 'uteis', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TB', '[{"nome":"N2","prazo_dias":2,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select nome into v_err from workflow_etapas where id = v_e0;
  assert v_err = 'N2', format('(b) nome herdado deve seguir, veio %s', v_err);
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'Custom', format('(b) nome customizado deve ficar, veio %s', v_err);
  -- (k) fluxo 100% preservado nao recebe evento
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_cnt = 0, '(k) fluxo com tudo preservado nao deve ter evento';

  -- ---------------------------------------------------------------------
  -- (c) par de prazo: so tipo_prazo muda (5 corridos -> 5 uteis)
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TC', '[{"nome":"P","prazo_dias":5,"tipo_prazo":"corridos","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'C1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'P', 5, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'C2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf2, 0, 'P', 10, 'corridos', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TC', '[{"nome":"P","prazo_dias":5,"tipo_prazo":"uteis","tipo":"padrao"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 5 and r.tipo_prazo = 'uteis', format('(c) herdado: par segue, veio %s %s', r.prazo_dias, r.tipo_prazo);
  select * into r from workflow_etapas where id = v_e1;
  assert r.prazo_dias = 10 and r.tipo_prazo = 'corridos',
    format('(c) prazo_dias customizado: par inteiro fica, veio %s %s', r.prazo_dias, r.tipo_prazo);
  select metadata into v_meta from workflow_events where workflow_id = v_wf and event_type = 'template_propagado';
  assert v_meta->'alteracoes' = jsonb_build_array(jsonb_build_object(
      'etapa_id', v_e0, 'ordem', 0, 'campo', 'prazo',
      'de',   jsonb_build_object('prazo_dias', 5, 'tipo_prazo', 'corridos'),
      'para', jsonb_build_object('prazo_dias', 5, 'tipo_prazo', 'uteis'))),
    format('(k) alteracao de prazo deve registrar o par, veio %s', v_meta->'alteracoes');

  -- ---------------------------------------------------------------------
  -- (d) tipo: padrao -> aprovacao_cliente
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TD', '[{"nome":"T","prazo_dias":1,"tipo_prazo":"corridos","tipo":"padrao"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'D1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'T', 1, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'D2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'T', 1, 'corridos', 'padrao', 'ativo', now()) returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TD', '[{"nome":"T","prazo_dias":1,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select tipo into v_err from workflow_etapas where id = v_e0;
  assert v_err = 'aprovacao_cliente', format('(d) pendente herdado recebe tipo, veio %s', v_err);
  select tipo into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'padrao', format('(d) ativo nunca recebe tipo, veio %s', v_err);
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_cnt = 0, '(d) ativo sem nada escrito: sem evento';

  -- ---------------------------------------------------------------------
  -- (e) normalizacao: template antigo sem tipo_prazo e responsavel_id ""
  --     fluxo com tipo_prazo NULL e responsavel NULL: tudo conta como herdado
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TE', '[{"nome":"Z","prazo_dias":2,"responsavel_id":""}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'E1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 0, 'Z', 2, null, null, 'padrao', 'pendente') returning id into v_e0;

  perform update_workflow_template(v_tpl, 'TE', jsonb_build_array(
    jsonb_build_object('nome','Z','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',v_ma)), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 3 and r.tipo_prazo = 'corridos',
    format('(e) tipo_prazo NULL/ausente conta como herdado, veio %s %s', r.prazo_dias, r.tipo_prazo);
  assert r.responsavel_id = v_ma, '(e) responsavel "" no template = NULL no fluxo = herdado';

  -- ---------------------------------------------------------------------
  -- (f) parse defensivo do template antigo
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TF', '[{"nome":"D","prazo_dias":2.5,"tipo_prazo":"corridos","responsavel_id":"abc"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'F1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 0, 'D', 7, 'corridos', null, 'padrao', 'pendente') returning id into v_e0;

  v_err := pg_temp.uwt_err(v_tpl, 'TF', jsonb_build_array(
    jsonb_build_object('nome','D','prazo_dias',4,'tipo_prazo','corridos','responsavel_id',v_ma)), 'padrao');
  assert v_err is null, format('(f) template antigo malformado nao pode travar o save, levantou %s', v_err);
  -- uwt_err nao reseta a GUC em caso de sucesso
  perform set_config('app.suppress_workflow_events', '0', true);
  select * into r from workflow_etapas where id = v_e0;
  assert r.prazo_dias = 7, format('(f) prazo antigo ilegivel = sem valor antigo = mantem, veio %s', r.prazo_dias);
  assert r.responsavel_id is null, '(f) responsavel antigo ilegivel = mantem';
  select etapas into v_snap from workflow_templates where id = v_tpl;
  assert (v_snap->0->>'prazo_dias')::int = 4, '(f) o template corrigido foi salvo';

  -- etapas antigas nao-array
  update workflow_templates set etapas = '{"bogus":true}' where id = v_tpl;
  v_err := pg_temp.uwt_err(v_tpl, 'TF', '[{"nome":"D","prazo_dias":9,"tipo_prazo":"corridos"}]', 'padrao');
  assert v_err is null, format('(f) etapas antigas nao-array nao pode travar o save, levantou %s', v_err);
  perform set_config('app.suppress_workflow_events', '0', true);
  select prazo_dias into v_cnt from workflow_etapas where id = v_e0;
  assert v_cnt = 7, '(f) sem template antigo: fluxo mantem tudo';

  -- ---------------------------------------------------------------------
  -- (g) concluida intocada; fluxo maior que o template antigo
  -- (h) template encolhe
  -- (j) backfill
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TG', '[{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  -- G1: [A concluido herdado, B pendente herdado, Extra pendente] (fluxo maior que o template antigo)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'G1', v_tpl, 'ativo', 1, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, concluido_em)
    values (v_wf, 0, 'A', 1, 'corridos', 'padrao', 'concluido', '2026-01-01 10:00+00', '2026-01-02 10:00+00') returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 1, 'B', 1, 'corridos', 'padrao', 'pendente') returning id into v_e1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 2, 'Extra', 8, 'uteis', 'padrao', 'pendente') returning id into v_e2;
  -- G2: [A ativo] (recebe backfill de B2 e C2)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'G2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf2, 0, 'A', 1, 'corridos', 'padrao', 'ativo', now()) returning id into v_e3;

  perform update_workflow_template(v_tpl, 'TG',
    '[{"nome":"A2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"C2","prazo_dias":6,"tipo_prazo":"uteis"}]',
    'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'A' and r.status = 'concluido', '(g) concluida intocada';
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'B2', '(g) pendente herdada segue';
  select * into r from workflow_etapas where id = v_e2;
  assert r.nome = 'Extra' and r.prazo_dias = 8, '(g) sem valor antigo na posicao 2: Extra fica';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, '(g) G1 ja tinha a ordem 2: sem backfill';
  select nome into v_err from workflow_etapas where id = v_e3;
  assert v_err = 'A2', '(j) ativa herdada segue';
  select * into r from workflow_etapas where workflow_id = v_wf2 and ordem = 2;
  assert found and r.nome = 'C2' and r.prazo_dias = 6 and r.tipo_prazo = 'uteis'
     and r.status = 'pendente' and r.data_limite is null and r.iniciado_em is null,
    '(j) backfill com os valores novos, pendente, sem data_limite';
  select metadata into v_meta from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert (v_meta->>'etapas_atualizadas')::int = 1 and (v_meta->>'etapas_criadas')::int = 2,
    format('(j) contagens G2: %s', v_meta);

  -- (h) encolhe para [A2]: B2 e Extra de G1 ficam intocados
  perform update_workflow_template(v_tpl, 'TG', '[{"nome":"A2","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);
  select nome into v_err from workflow_etapas where id = v_e1;
  assert v_err = 'B2', '(h) etapa alem do fim do template novo fica intocada';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, '(h) nada e apagado';

  -- ---------------------------------------------------------------------
  -- (i) reordenacao: [A 1, B 2] -> [B 2, A 1]; fluxo [A prazo 10 (custom), B 2]
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TI', '[{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"B","prazo_dias":2,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'I1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'A', 10, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 1, 'B', 2, 'corridos', 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TI',
    '[{"nome":"B","prazo_dias":2,"tipo_prazo":"corridos"},{"nome":"A","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'B' and r.prazo_dias = 10, format('(i) posicao 0: nome segue, prazo custom fica, veio %s %s', r.nome, r.prazo_dias);
  select * into r from workflow_etapas where id = v_e1;
  assert r.nome = 'A' and r.prazo_dias = 1, format('(i) posicao 1: tudo herdado segue, veio %s %s', r.nome, r.prazo_dias);

  -- ---------------------------------------------------------------------
  -- (l) tenancy
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TL', '[{"nome":"L","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  -- fluxo de OUTRO tenant apontando para o template de v_ws (FK envenenada)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws2, v_other, v_cli2, 'Poison', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf3;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf3, 0, 'L', 1, 'corridos', 'padrao', 'pendente') returning id into v_e4;

  perform update_workflow_template(v_tpl, 'TL', '[{"nome":"L2","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"M","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);
  select nome into v_err from workflow_etapas where id = v_e4;
  assert v_err = 'L', '(l) fluxo de outro tenant nao pode ser tocado';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf3;
  assert v_cnt = 1, '(l) sem backfill cross-tenant';

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  v_err := pg_temp.uwt_err(v_tpl, 'TL', '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_not_found', format('(l) template de outro workspace, veio %s', v_err);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------
  -- (m) validacao
  -- ---------------------------------------------------------------------
  v_err := pg_temp.uwt_err(v_tpl, null, '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, '   ', '[{"nome":"X","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome em branco, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}]', null);
  assert v_err = 'template_invalid', format('(m) modo NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}]', 'semanal');
  assert v_err = 'template_invalid', format('(m) modo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', null, 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas NULL, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[]', 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas vazio, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '{"nome":"X"}', 'padrao');
  assert v_err = 'template_invalid', format('(m) etapas nao-array, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1}, 5]', 'padrao');
  assert v_err = 'template_invalid', format('(m) array misturando objeto e escalar, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) sem nome, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":" ","prazo_dias":1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) nome da etapa em branco, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) sem prazo_dias, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":"3"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias string, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":2.5}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias decimal, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":-1}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias negativo, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1000}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) prazo_dias 1000, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"tipo_prazo":"semanas"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) tipo_prazo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"tipo":"outro"}]', 'padrao');
  assert v_err = 'template_invalid', format('(m) tipo invalido, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', jsonb_build_array(jsonb_build_object('nome','X','prazo_dias',1,'responsavel_id',v_mx)), 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel de outro workspace, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"responsavel_id":"abc"}]', 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel nao numerico, veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"responsavel_id":"5"}]', 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel como string numerica ("5"), veio %s', v_err);
  v_err := pg_temp.uwt_err(v_tpl, 'T', '[{"nome":"X","prazo_dias":1,"responsavel_id":""}]', 'padrao');
  assert v_err = 'invalid_responsavel', format('(m) responsavel string vazia, veio %s', v_err);
  -- limites validos passam
  v_err := pg_temp.uwt_err(v_tpl, 'TL', '[{"nome":"L2","prazo_dias":0,"tipo_prazo":null,"tipo":null,"responsavel_id":null},{"nome":"M","prazo_dias":999}]', 'padrao');
  assert v_err is null, format('(m) prazo 0 e 999, chaves null, devem passar, levantou %s', v_err);
  perform set_config('app.suppress_workflow_events', '0', true);

  -- ---------------------------------------------------------------------
  -- (n) modo_prazo so no template
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TN', '[{"nome":"Q","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'N1', v_tpl, 'ativo', 0, false, 'data_fixa') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, data_limite)
    values (v_wf, 0, 'Q', 1, 'corridos', 'padrao', 'pendente', '2026-10-10') returning id into v_e0;

  perform update_workflow_template(v_tpl, 'TN', '[{"nome":"Q","prazo_dias":4,"tipo_prazo":"corridos"}]', 'data_entrega');
  perform set_config('app.suppress_workflow_events', '0', true);
  select modo_prazo into v_err from workflow_templates where id = v_tpl;
  assert v_err = 'data_entrega', '(n) template recebe o modo novo';
  select modo_prazo into v_err from workflows where id = v_wf;
  assert v_err = 'data_fixa', '(n) workflows.modo_prazo intocado';
  select * into r from workflow_etapas where id = v_e0;
  assert r.data_limite = '2026-10-10'::date and r.prazo_dias = 4, '(n) data_limite intocado; prazo herdado segue';

  -- ---------------------------------------------------------------------
  -- (o) evento transacional: a falha ao gravar o evento faz a chamada levantar
  --     (o RPC antigo engolia essa falha com um WARNING)
  -- ---------------------------------------------------------------------
  alter table workflow_events add constraint uwt_force_fail
    check (event_type <> 'template_propagado') not valid;
  v_err := pg_temp.uwt_err(v_tpl, 'TN', '[{"nome":"Q","prazo_dias":5,"tipo_prazo":"corridos"}]', 'data_entrega');
  assert v_err is not null and v_err like '%uwt_force_fail%',
    format('(o) falha do evento deve levantar, veio %s', coalesce(v_err, 'NULL (engolida)'));
  alter table workflow_events drop constraint uwt_force_fail;
  select prazo_dias into v_cnt from workflow_etapas where id = v_e0;
  assert v_cnt = 4, '(o) nada da chamada que falhou ficou gravado';

  -- ---------------------------------------------------------------------
  -- (p) RPC antigo: so backfill
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TP', '[{"nome":"Novo0","prazo_dias":9,"tipo_prazo":"uteis"},{"nome":"Novo1","prazo_dias":2,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'P1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'Velho0', 1, 'corridos', 'padrao', 'pendente') returning id into v_e0;

  perform propagate_template_to_workflows(v_tpl);
  perform set_config('app.suppress_workflow_events', '0', true);
  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'Velho0' and r.prazo_dias = 1 and r.tipo_prazo = 'corridos',
    format('(p) RPC antigo nao pode sobrescrever, veio %s %s %s', r.nome, r.prazo_dias, r.tipo_prazo);
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 1;
  assert found and r.nome = 'Novo1' and r.status = 'pendente', '(p) RPC antigo ainda faz backfill';
  select metadata into v_meta from workflow_events where workflow_id = v_wf and event_type = 'template_propagado';
  assert (v_meta->>'etapas_atualizadas')::int = 0 and (v_meta->>'etapas_criadas')::int = 1,
    format('(p) metadata do RPC antigo: %s', v_meta);

  -- ---------------------------------------------------------------------
  -- (q) limpar responsavel: template antigo A, novo sem responsavel_id (NULL)
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TQ', jsonb_build_array(
      jsonb_build_object('nome','Q','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',v_ma,'tipo','padrao')
    ), 'padrao') returning id into v_tpl;
  -- fluxo herdado: ainda em A
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Q1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf, 0, 'Q', 1, 'corridos', v_ma, 'padrao', 'pendente') returning id into v_e0;
  -- fluxo customizado: ja em B
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Q2', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo, status)
    values (v_wf2, 0, 'Q', 1, 'corridos', v_mb, 'padrao', 'pendente') returning id into v_e1;

  perform update_workflow_template(v_tpl, 'TQ', jsonb_build_array(
    jsonb_build_object('nome','Q','prazo_dias',1,'tipo_prazo','corridos','tipo','padrao')
  ), 'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.responsavel_id is null, format('(q) herdado: responsavel deve ser limpo, veio %s', r.responsavel_id);
  select * into r from workflow_etapas where id = v_e1;
  assert r.responsavel_id = v_mb, '(q) customizado (B) fica intocado';

  select metadata into v_meta from workflow_events where workflow_id = v_wf and event_type = 'template_propagado';
  assert v_meta is not null, '(q) fluxo herdado foi tocado: deve ter evento';
  assert v_meta->'alteracoes' = jsonb_build_array(jsonb_build_object(
      'etapa_id', v_e0, 'ordem', 0, 'campo', 'responsavel_id', 'de', v_ma, 'para', null::bigint)),
    format('(q) alteracoes devem ter para:null, veio %s', v_meta->'alteracoes');
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf2 and event_type = 'template_propagado';
  assert v_cnt = 0, '(q) fluxo ja customizado (B) nao deve ter evento';

  -- ---------------------------------------------------------------------
  -- (r) etapas antigas com elemento nao-objeto na posicao 0
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'TR', '[{"nome":"R0","prazo_dias":1,"tipo_prazo":"corridos"},{"nome":"R1","prazo_dias":2,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl;
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'R1', v_tpl, 'ativo', 0, false, 'padrao') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 0, 'R0', 1, 'corridos', 'padrao', 'pendente') returning id into v_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf, 1, 'R1', 2, 'corridos', 'padrao', 'pendente') returning id into v_e1;

  -- corrompe o template salvo diretamente: posicao 0 vira um escalar
  update workflow_templates set etapas =
    jsonb_build_array(5, jsonb_build_object('nome','R1','prazo_dias',2,'tipo_prazo','corridos'))
    where id = v_tpl;

  perform update_workflow_template(v_tpl, 'TR',
    '[{"nome":"R0-novo","prazo_dias":9,"tipo_prazo":"uteis"},{"nome":"R1-novo","prazo_dias":8,"tipo_prazo":"uteis"}]',
    'padrao');
  perform set_config('app.suppress_workflow_events', '0', true);

  select * into r from workflow_etapas where id = v_e0;
  assert r.nome = 'R0' and r.prazo_dias = 1 and r.tipo_prazo = 'corridos',
    format('(r) posicao 0 com old nao-objeto: etapa fica intocada, veio %s %s %s', r.nome, r.prazo_dias, r.tipo_prazo);
  select * into r from workflow_etapas where id = v_e1;
  assert r.nome = 'R1-novo' and r.prazo_dias = 8 and r.tipo_prazo = 'uteis',
    format('(r) posicao 1 segue o merge normal, veio %s %s %s', r.nome, r.prazo_dias, r.tipo_prazo);

  raise notice 'PASS update_workflow_template';
end $$;
rollback;
