-- Valida supabase/migrations/20260826000001_workflow_events.sql (tabela workflow_events,
-- RLS, record_workflow_event(), Triggers A/B/C) e
-- supabase/migrations/20260826000002_workflow_events_rpc_integration.sql
-- (migrate_workflow_template recriado, propagate_template_to_workflows novo).
--
-- Casos:
--   (a) criacao: evento 'criado' via app.actor_id; e via fallback para user_id quando
--       app.actor_id e auth.uid() estao ausentes
--   (b) avanco: 'etapa_concluida' + 'etapa_iniciada' com snapshot de ator nomeado
--   (c) conclusao final: 'etapa_concluida' E 'fluxo_concluido' (emissao dupla proposital)
--   (d) revert: das duas escritas, so a segunda emite 'etapa_revertida'; metadata.voltou_de
--   (e) reopen: das duas escritas, so a segunda emite 'fluxo_reaberto'; etapa_id/etapa_nome
--       da ancora de inicio (caminho distinto do revert, mesma transicao concluido->ativo)
--   (f) 'fluxo_editado': diffs de titulo (sem label) e cliente_id (com from_label/to_label);
--       position e etapa_atual sao ignorados
--   (g) 'etapa_editada': diffs de responsavel_id (com label) e prazo_dias (sem label)
--   (h) ordenacom na mesma transacao: id desempata created_at igual
--   (i) RLS: leitura no mesmo workspace ok, outro workspace zero linhas, INSERT direto
--       negado (sem policy), chamada direta a record_workflow_event negada (P1)
--   (j) GUC de supressao: escrita sob app.suppress_workflow_events='1' nao gera evento
--   (k) FKs envenenadas entre tenants: label omitido (nao nulo, ausente) quando o id
--       referenciado nao pertence ao tenant do workflow
--   (l) integracao com migrate_workflow_template: exatamente 1 evento 'template_migrado'
--       por chamada (nenhum ruido de trigger de linha vaza)
--   (m) integracao com propagate_template_to_workflows: 1 'template_propagado' por
--       workflow tocado (nao por etapa); etapa concluida intocada; tipo so sincroniza em
--       'pendente'; fluxo de outro tenant com template_id coincidente nao e tocado
--
-- Estrutural: tanto migrate_workflow_template quanto propagate_template_to_workflows
-- fazem set_config('app.suppress_workflow_events', '1', true) e NUNCA resetam para '0'
-- antes de retornar. Este arquivo usa um unico bloco begin/rollback (como
-- migrate_workflow_template.sql) e reseta a GUC explicitamente para '0' logo apos cada
-- chamada de RPC, antes de qualquer asserção subsequente que dependa do disparo normal
-- dos triggers.
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner  uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();

  v_cli1 bigint;
  v_cli_from bigint; v_cli_to bigint;
  v_cli_poison_a bigint; v_cli_poison_b bigint;
  v_membro_a bigint; v_membro_b bigint;

  v_wf_a1 bigint; v_wf_a2 bigint;
  v_wf_b bigint; v_etapa_b0 bigint; v_etapa_b1 bigint;
  v_wf_c bigint; v_etapa_c0 bigint; v_etapa_c1 bigint;
  v_wf_d bigint; v_etapa_d0 bigint; v_etapa_d1 bigint;
  v_wf_e bigint; v_etapa_e0 bigint; v_etapa_e1 bigint;
  v_wf_f bigint;
  v_wf_g bigint; v_etapa_g0 bigint;
  v_wf_h bigint;
  v_wf_j bigint; v_etapa_j0 bigint;
  v_wf_k bigint;

  v_tpl_l_from bigint; v_tpl_l_to bigint; v_wf_l bigint; v_new_etapa_l bigint;

  v_tpl_m bigint;
  v_wf_m_pend bigint; v_etapa_m_pend bigint;
  v_wf_m_ativo bigint; v_etapa_m_ativo bigint;
  v_wf_m_mixed bigint; v_etapa_m_concl bigint; v_etapa_m_mixed1 bigint; v_etapa_m_mixed2 bigint;
  v_wf_poison_prop bigint; v_etapa_poison_prop bigint;

  v_snap_concl_nome text; v_snap_concl_prazo int; v_snap_concl_tp text; v_snap_concl_tipo text;
  v_snap_concl_resp bigint; v_snap_concl_status text;
  v_snap_concl_ini timestamptz; v_snap_concl_conc timestamptz;
  v_snap_poison_nome text; v_snap_poison_prazo int; v_snap_poison_tp text;
  v_snap_poison_tipo text; v_snap_poison_resp bigint;

  v_cnt int; v_cnt_before int; v_cnt_after int;
  v_meta jsonb; v_entry jsonb;
  v_actor_uid uuid; v_actor_nm text;
  v_blocked boolean;
  v_id1 bigint; v_id2 bigint; v_type1 text; v_type2 text;
  v_txt text;
  v_bigint2 bigint;
  r record;
begin
  -- ---------------------------------------------------------------------
  -- Fixtures compartilhadas
  -- ---------------------------------------------------------------------
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_member), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_member, v_ws, 'agent'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws,  nome = 'Ana Dona'    where id = v_owner;
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws,  nome = 'Bruno Membro' where id = v_member;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2, nome = 'Carla Outra'  where id = v_other;

  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_owner, 'Cliente A1', 'CA1', '#000') returning id into v_cli1;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_owner, 'Cliente Origem F', 'COF', '#001') returning id into v_cli_from;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_owner, 'Cliente Destino F', 'CDF', '#002') returning id into v_cli_to;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_owner, 'Cliente Poison A1', 'CPA1', '#003') returning id into v_cli_poison_a;
  insert into clientes (conta_id, user_id, nome, sigla, cor) values (v_ws, v_owner, 'Cliente Poison A2', 'CPA2', '#004') returning id into v_cli_poison_b;

  insert into membros (conta_id, user_id, nome) values (v_ws, v_owner, 'Membro A') returning id into v_membro_a;
  insert into membros (conta_id, user_id, nome) values (v_ws, v_owner, 'Membro B') returning id into v_membro_b;

  -- ---------------------------------------------------------------------
  -- (a) Criacao
  -- ---------------------------------------------------------------------
  perform set_config('app.actor_id', v_owner::text, true);
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo, created_via)
    values (v_ws, v_owner, v_cli1, 'Fluxo A1', 'ativo', 0, false, 'padrao', 'human')
    returning id into v_wf_a1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_a1, 0, 'Etapa A1-0', 2, 'uteis', 'ativo', now());
  perform set_config('app.actor_id', '', true);

  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_a1;
  assert v_cnt = 1, format('esperava exatamente 1 evento criado, veio %s', v_cnt);

  select actor_user_id, actor_name, metadata into v_actor_uid, v_actor_nm, v_meta
    from workflow_events where workflow_id = v_wf_a1 and event_type = 'criado';
  assert v_actor_uid = v_owner, 'actor_user_id deve resolver via app.actor_id';
  assert v_actor_nm = 'Ana Dona', 'actor_name deve resolver via profiles.nome';
  assert v_meta->>'titulo' = 'Fluxo A1', 'metadata.titulo deve refletir o valor inserido';
  assert (v_meta->>'recorrente')::boolean = false, 'metadata.recorrente deve refletir o valor inserido';
  assert v_meta->>'created_via' = 'human', 'metadata.created_via deve refletir o valor inserido';

  -- fallback: user_id quando app.actor_id e auth.uid() estao ausentes
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_member, v_cli1, 'Fluxo A2', 'ativo', 0, false, 'padrao')
    returning id into v_wf_a2;

  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_a2;
  assert v_cnt = 1, 'fallback tambem deve gravar exatamente 1 evento criado';
  select actor_user_id, actor_name into v_actor_uid, v_actor_nm
    from workflow_events where workflow_id = v_wf_a2 and event_type = 'criado';
  assert v_actor_uid = v_member, 'sem app.actor_id/auth.uid(), actor_user_id deve cair para o user_id da linha';
  assert v_actor_nm = 'Bruno Membro', 'actor_name deve resolver via profiles.nome do fallback';
  assert v_actor_nm is distinct from 'Sistema', 'fallback nao pode cair em Sistema quando ha user_id';

  -- ---------------------------------------------------------------------
  -- (b) Avanco
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo B', 'ativo', 0, false, 'padrao')
    returning id into v_wf_b;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_b, 0, 'Etapa B0', 1, 'uteis', 'ativo', now()) returning id into v_etapa_b0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (v_wf_b, 1, 'Etapa B1', 1, 'uteis', 'pendente') returning id into v_etapa_b1;

  perform set_config('app.actor_id', v_member::text, true);
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_etapa_b0;
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_etapa_b1;
  update workflows set etapa_atual = 1 where id = v_wf_b;
  perform set_config('app.actor_id', '', true);

  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_b and event_type = 'etapa_concluida' and etapa_id = v_etapa_b0;
  assert v_cnt = 1, 'deve existir exatamente 1 evento etapa_concluida para a etapa 0';
  select actor_name into v_actor_nm from workflow_events
    where workflow_id = v_wf_b and event_type = 'etapa_concluida' and etapa_id = v_etapa_b0;
  assert v_actor_nm = 'Bruno Membro', 'etapa_concluida deve carregar o snapshot do ator nomeado';

  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_b and event_type = 'etapa_iniciada' and etapa_id = v_etapa_b1;
  assert v_cnt = 1, 'deve existir exatamente 1 evento etapa_iniciada para a etapa 1';
  select actor_name into v_actor_nm from workflow_events
    where workflow_id = v_wf_b and event_type = 'etapa_iniciada' and etapa_id = v_etapa_b1;
  assert v_actor_nm = 'Bruno Membro', 'etapa_iniciada deve carregar o snapshot do ator nomeado';

  -- ---------------------------------------------------------------------
  -- (c) Conclusao final
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo C', 'ativo', 1, false, 'padrao')
    returning id into v_wf_c;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em, concluido_em)
    values (v_wf_c, 0, 'Etapa C0', 1, 'uteis', 'concluido', now(), now()) returning id into v_etapa_c0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_c, 1, 'Etapa C1', 1, 'uteis', 'ativo', now()) returning id into v_etapa_c1;

  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_etapa_c1;
  update workflows set status = 'concluido', etapa_atual = 1 where id = v_wf_c;

  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_c and event_type = 'etapa_concluida' and etapa_id = v_etapa_c1;
  assert v_cnt = 1, 'ultima etapa concluida deve gerar etapa_concluida';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_c and event_type = 'fluxo_concluido';
  assert v_cnt = 1, 'conclusao do fluxo deve gerar fluxo_concluido (emissao dupla e proposital)';

  -- ---------------------------------------------------------------------
  -- (d) Revert
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo D', 'ativo', 1, false, 'padrao')
    returning id into v_wf_d;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, concluido_em)
    values (v_wf_d, 0, 'Etapa D0', 1, 'uteis', 'concluido', now()) returning id into v_etapa_d0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_d, 1, 'Etapa D1', 1, 'uteis', 'ativo', now()) returning id into v_etapa_d1;

  -- write #1 (revertEtapa): ativo -> pendente na etapa 1. Nao deve emitir NENHUM evento
  -- (de nenhum tipo -- nao so etapa_revertida; guarda contra um futuro etapa_editada
  -- vazando se status/iniciado_em/concluido_em algum dia entrarem no diff observado).
  select count(*) into v_cnt_before from workflow_events where workflow_id = v_wf_d;
  update workflow_etapas set status = 'pendente', iniciado_em = null where id = v_etapa_d1;
  select count(*) into v_cnt_after from workflow_events where workflow_id = v_wf_d;
  assert v_cnt_after = v_cnt_before,
    format('primeira escrita do revert nao deve gerar nenhum evento de nenhum tipo, gerou %s', v_cnt_after - v_cnt_before);

  -- write #2: concluido -> ativo na etapa 0, com o pai ainda 'ativo'. Deve emitir etapa_revertida.
  update workflow_etapas set status = 'ativo', concluido_em = null where id = v_etapa_d0;

  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_d and event_type = 'etapa_revertida';
  assert v_cnt = 1, 'revert deve gerar exatamente 1 evento etapa_revertida (a primeira escrita nao emite nada)';
  select metadata into v_meta from workflow_events where workflow_id = v_wf_d and event_type = 'etapa_revertida';
  assert v_meta->>'voltou_de' = 'Etapa D1', 'voltou_de deve nomear a etapa da qual se esta recuando';
  assert (v_meta->>'voltou_de_etapa_id')::bigint = v_etapa_d1, 'voltou_de_etapa_id deve apontar para a etapa 1';

  -- ---------------------------------------------------------------------
  -- (e) Reopen
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo E', 'concluido', 1, false, 'padrao')
    returning id into v_wf_e;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, concluido_em)
    values (v_wf_e, 0, 'Etapa E0', 1, 'uteis', 'concluido', now()) returning id into v_etapa_e0;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, concluido_em)
    values (v_wf_e, 1, 'Etapa E1', 1, 'uteis', 'concluido', now()) returning id into v_etapa_e1;

  -- write #1 (reopenWorkflow): concluido -> ativo na etapa, com o pai AINDA 'concluido'. Nada
  -- emitido (de nenhum tipo -- mesma guarda total-delta do caso (d), nao so os tipos
  -- etapa_revertida/etapa_iniciada/etapa_concluida checados abaixo).
  select count(*) into v_cnt_before from workflow_events where workflow_id = v_wf_e;
  update workflow_etapas set status = 'ativo', concluido_em = null, iniciado_em = now() where id = v_etapa_e1;
  select count(*) into v_cnt_after from workflow_events where workflow_id = v_wf_e;
  assert v_cnt_after = v_cnt_before,
    format('a escrita no nivel de etapa do reopen nao deve gerar nenhum evento de nenhum tipo, gerou %s', v_cnt_after - v_cnt_before);

  -- write #2: workflow concluido -> ativo. Deve emitir fluxo_reaberto ancorado na etapa reativada.
  update workflows set status = 'ativo', etapa_atual = 1 where id = v_wf_e;

  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_e and event_type = 'fluxo_reaberto';
  assert v_cnt = 1, 'reopen deve gerar exatamente 1 evento fluxo_reaberto';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_e and etapa_id = v_etapa_e1
      and event_type in ('etapa_revertida', 'etapa_iniciada', 'etapa_concluida');
  assert v_cnt = 0, 'a escrita no nivel de etapa do reopen nao deve emitir nada (caminho diferente do revert)';

  select etapa_id, etapa_nome into v_bigint2, v_txt from workflow_events
    where workflow_id = v_wf_e and event_type = 'fluxo_reaberto';
  assert v_bigint2 = v_etapa_e1, 'fluxo_reaberto deve identificar a etapa reativada (ancora de inicio)';
  assert v_txt = 'Etapa E1', 'fluxo_reaberto deve trazer o nome da etapa reativada';

  -- ---------------------------------------------------------------------
  -- (f) fluxo_editado
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli_from, 'Fluxo F Antigo', 'ativo', 0, false, 'padrao')
    returning id into v_wf_f;

  update workflows set titulo = 'Fluxo F Novo', cliente_id = v_cli_to where id = v_wf_f;

  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_f and event_type = 'fluxo_editado';
  assert v_cnt = 1, 'titulo+cliente_id em 1 UPDATE deve gerar 1 fluxo_editado';

  select metadata into v_meta from workflow_events
    where workflow_id = v_wf_f and event_type = 'fluxo_editado' order by id asc limit 1;

  select count(*) into v_cnt from jsonb_array_elements(v_meta->'changes') c
    where c->>'field' = 'titulo' and c->>'from' = 'Fluxo F Antigo' and c->>'to' = 'Fluxo F Novo';
  assert v_cnt = 1, 'changes deve conter titulo sem labels';

  select c into v_entry from jsonb_array_elements(v_meta->'changes') c where c->>'field' = 'cliente_id' limit 1;
  assert v_entry is not null, 'changes deve conter cliente_id';
  assert (v_entry->>'from')::bigint = v_cli_from and (v_entry->>'to')::bigint = v_cli_to,
    'from/to de cliente_id devem ser os ids brutos';
  assert v_entry->>'from_label' = 'Cliente Origem F', 'from_label deve resolver o nome antigo';
  assert v_entry->>'to_label' = 'Cliente Destino F', 'to_label deve resolver o nome novo';

  update workflows set position = 7 where id = v_wf_f;
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_f and event_type = 'fluxo_editado';
  assert v_cnt = 1, 'position nao e observado; nao deve gerar novo fluxo_editado';

  update workflows set etapa_atual = 3 where id = v_wf_f;
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_f and event_type = 'fluxo_editado';
  assert v_cnt = 1, 'etapa_atual nao e observado; nao deve gerar novo fluxo_editado';

  -- ---------------------------------------------------------------------
  -- (g) etapa_editada
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo G', 'ativo', 0, false, 'padrao')
    returning id into v_wf_g;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, status)
    values (v_wf_g, 0, 'Etapa G0', 2, 'uteis', v_membro_a, 'pendente')
    returning id into v_etapa_g0;

  update workflow_etapas set responsavel_id = v_membro_b, prazo_dias = 5 where id = v_etapa_g0;

  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_g and event_type = 'etapa_editada' and etapa_id = v_etapa_g0;
  assert v_cnt = 1, 'deve existir exatamente 1 evento etapa_editada';

  select metadata into v_meta from workflow_events
    where workflow_id = v_wf_g and event_type = 'etapa_editada' and etapa_id = v_etapa_g0
    order by id asc limit 1;

  select c into v_entry from jsonb_array_elements(v_meta->'changes') c where c->>'field' = 'responsavel_id' limit 1;
  assert v_entry is not null, 'changes deve conter responsavel_id';
  assert (v_entry->>'from')::bigint = v_membro_a and (v_entry->>'to')::bigint = v_membro_b,
    'from/to de responsavel_id devem ser os ids brutos';
  assert v_entry->>'from_label' = 'Membro A' and v_entry->>'to_label' = 'Membro B',
    'labels devem resolver via membros.nome';

  select c into v_entry from jsonb_array_elements(v_meta->'changes') c where c->>'field' = 'prazo_dias' limit 1;
  assert v_entry is not null, 'changes deve conter prazo_dias';
  assert (v_entry->>'from')::int = 2 and (v_entry->>'to')::int = 5, 'from/to de prazo_dias devem ser os valores brutos';
  assert not (v_entry ? 'from_label') and not (v_entry ? 'to_label'), 'prazo_dias nao tem labels';

  -- ---------------------------------------------------------------------
  -- (h) Ordenacao na mesma transacao
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo H Antigo', 'ativo', 0, false, 'padrao')
    returning id into v_wf_h;

  -- Um UPDATE so, mudando status (branch 1: fluxo_arquivado, roda primeiro no corpo do
  -- trigger) e titulo (branch 2: fluxo_editado, roda depois) -- dois INSERTs na mesma
  -- invocacao do trigger, mesmo statement. Toda a suite roda em uma unica transacao, entao
  -- now() (= transaction_timestamp()) e identico para TODAS as linhas de workflow_events
  -- do arquivo -- o desempate por id e a unica coisa que pode provar a ordem real.
  update workflows set status = 'arquivado', titulo = 'Fluxo H Novo' where id = v_wf_h;

  -- Prova que a colisao de created_at realmente acontece antes de confiar no desempate
  -- por id abaixo -- sem isso, "assert v_id1 < v_id2" seria tautologico (id ja ordena
  -- corretamente sozinho, colisao ou nao, entao a asserção passaria mesmo se o
  -- desempate por id no indice (workflow_id, created_at, id) estivesse quebrado).
  select count(distinct created_at) into v_cnt from workflow_events
    where workflow_id = v_wf_h and event_type in ('fluxo_arquivado', 'fluxo_editado');
  assert v_cnt = 1,
    'os dois eventos precisam compartilhar o mesmo created_at para o teste de desempate por id ser significativo';

  select id, event_type into v_id1, v_type1 from workflow_events
    where workflow_id = v_wf_h and event_type in ('fluxo_arquivado', 'fluxo_editado')
    order by created_at asc, id asc limit 1;
  select id, event_type into v_id2, v_type2 from workflow_events
    where workflow_id = v_wf_h and event_type in ('fluxo_arquivado', 'fluxo_editado')
    order by created_at asc, id asc offset 1 limit 1;

  assert v_type1 = 'fluxo_arquivado' and v_type2 = 'fluxo_editado',
    format('esperava fluxo_arquivado antes de fluxo_editado, veio %s antes de %s', v_type1, v_type2);
  assert v_id1 < v_id2, 'id deve desempatar created_at igual pela ordem real de insercao';

  -- ---------------------------------------------------------------------
  -- (i) RLS
  -- ---------------------------------------------------------------------
  -- et_grant_hosted_parity() concede no nivel de TABELA (paridade com o ACL padrao do
  -- hosted Supabase); nao mexe em privilegios de FUNCTION, entao o REVOKE de
  -- record_workflow_event feito na migration 1 continua intacto para (i-4). Chamada
  -- enquanto ainda somos o dono da tabela, antes de qualquer SET LOCAL ROLE abaixo.
  perform et_grant_hosted_parity();

  -- (i-1) membro do MESMO workspace do workflow enxerga as linhas
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_b;
  reset role;
  assert v_cnt > 0, 'membro do mesmo workspace deve enxergar os eventos do workflow';

  -- (i-2) usuario de OUTRO workspace enxerga zero linhas para o mesmo workflow
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_b;
  reset role;
  assert v_cnt = 0, 'usuario de outro workspace nao deve enxergar eventos de workflow alheio';

  -- (i-3) INSERT direto negado -- nao existe policy de INSERT
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  select count(*) into v_cnt_before from workflow_events where workflow_id = v_wf_b;
  v_blocked := false;
  begin
    insert into workflow_events (workflow_id, conta_id, event_type, source)
      values (v_wf_b, v_ws, 'criado', 'workspace_user');
    raise exception 'client conseguiu inserir em workflow_events diretamente';
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'nao deve existir policy de INSERT em workflow_events para authenticated';
  select count(*) into v_cnt_after from workflow_events where workflow_id = v_wf_b;
  assert v_cnt_after = v_cnt_before, 'a negacao nao pode ter criado nenhuma linha';

  -- (i-4) chamada direta a record_workflow_event negada (P1 do Task 1)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform record_workflow_event(v_wf_b, v_ws, 'criado', null, null, '{}'::jsonb, null);
    raise exception 'client conseguiu chamar record_workflow_event diretamente';
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'record_workflow_event deve negar EXECUTE para authenticated';

  -- ---------------------------------------------------------------------
  -- (j) GUC de supressao
  -- ---------------------------------------------------------------------
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo J', 'ativo', 0, false, 'padrao')
    returning id into v_wf_j;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (v_wf_j, 0, 'Etapa J0', 1, 'uteis', 'pendente')
    returning id into v_etapa_j0;

  perform set_config('app.suppress_workflow_events', '1', true);
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_etapa_j0;

  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_j and event_type = 'etapa_iniciada';
  assert v_cnt = 0, 'GUC de supressao deveria ter bloqueado o evento etapa_iniciada';
  select count(*) into v_cnt from workflow_events where workflow_id = v_wf_j;
  assert v_cnt = 1, 'com a GUC ativa, so o evento criado (anterior a supressao) deve existir';

  perform set_config('app.suppress_workflow_events', '0', true);

  -- ---------------------------------------------------------------------
  -- (k) FKs envenenadas entre tenants
  -- ---------------------------------------------------------------------
  -- Fluxo criado no workspace B (v_ws2) com cliente_id apontando para um cliente do
  -- workspace A (v_ws). Bypass deliberado de validacao de app: fixture de teste, o app
  -- nunca permitiria isso -- e exatamente o cenario que a resolucao tenant-scoped do
  -- trigger precisa recusar.
  insert into workflows (conta_id, user_id, cliente_id, titulo, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws2, v_other, v_cli_poison_a, 'Fluxo K Poison', 'ativo', 0, false, 'padrao')
    returning id into v_wf_k;

  -- Troca entre dois clientes que pertencem AMBOS ao workspace A -- nenhum dos dois
  -- resolve dentro do tenant do workflow (v_ws2), entao from_label e to_label devem
  -- estar ausentes (nao nulos: ausentes como chave).
  update workflows set cliente_id = v_cli_poison_b where id = v_wf_k;

  select metadata into v_meta from workflow_events
    where workflow_id = v_wf_k and event_type = 'fluxo_editado'
    order by id asc limit 1;
  assert v_meta is not null, 'edicao do cliente_id envenenado deve gerar fluxo_editado';

  select c into v_entry from jsonb_array_elements(v_meta->'changes') c where c->>'field' = 'cliente_id' limit 1;
  assert v_entry is not null, 'changes deve conter a entrada cliente_id';
  assert (v_entry->>'from')::bigint = v_cli_poison_a, 'from deve preservar o id bruto envenenado';
  assert (v_entry->>'to')::bigint = v_cli_poison_b, 'to deve preservar o id bruto envenenado';
  assert not (v_entry ? 'from_label'), 'from_label nao pode vazar nome de cliente de outro tenant';
  assert not (v_entry ? 'to_label'), 'to_label nao pode vazar nome de cliente de outro tenant';

  -- ---------------------------------------------------------------------
  -- (l) migrate_workflow_template integration
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template Origem L', '[]'::jsonb, 'padrao') returning id into v_tpl_l_from;
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template Destino L', '[]'::jsonb, 'padrao') returning id into v_tpl_l_to;

  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo L', v_tpl_l_from, 'ativo', 0, false, 'padrao')
    returning id into v_wf_l;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_l, 0, 'Etapa L0', 1, 'uteis', 'ativo', now());

  select count(*) into v_cnt_before from workflow_events where workflow_id = v_wf_l;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform migrate_workflow_template(
    v_wf_l, v_tpl_l_to,
    jsonb_build_array(jsonb_build_object(
      'nome', 'Nova Etapa L', 'prazo_dias', 1, 'tipo_prazo', 'corridos',
      'responsavel_id', null, 'tipo', 'padrao', 'data_limite', null)),
    0, 'padrao', v_tpl_l_from, 0
  );
  perform set_config('app.suppress_workflow_events', '0', true);

  select count(*) into v_cnt_after from workflow_events where workflow_id = v_wf_l;
  assert v_cnt_after - v_cnt_before = 1,
    format('migrate_workflow_template deve gravar exatamente 1 evento, gravou %s', v_cnt_after - v_cnt_before);

  select id into v_new_etapa_l from workflow_etapas where workflow_id = v_wf_l;

  select * into r from workflow_events
    where workflow_id = v_wf_l and event_type = 'template_migrado'
    order by id desc limit 1;
  assert found, 'deve existir evento template_migrado';
  assert r.etapa_id = v_new_etapa_l, 'etapa_id do evento deve ser a etapa recem-ativada';
  assert r.metadata->>'from_template_nome' = 'Template Origem L', 'metadata deve resolver from_template_nome';
  assert r.metadata->>'to_template_nome' = 'Template Destino L', 'metadata deve resolver to_template_nome';

  -- ---------------------------------------------------------------------
  -- (m) propagate_template_to_workflows integration
  -- ---------------------------------------------------------------------
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template M', '[]'::jsonb, 'padrao') returning id into v_tpl_m;

  -- "edita" o template depois de criado, como o brief pede
  update workflow_templates set etapas = jsonb_build_array(
    jsonb_build_object('nome', 'T0', 'prazo_dias', 3, 'tipo_prazo', 'corridos', 'responsavel_id', null, 'tipo', 'aprovacao_cliente'),
    jsonb_build_object('nome', 'T1', 'prazo_dias', 4, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao'),
    jsonb_build_object('nome', 'T2', 'prazo_dias', 5, 'tipo_prazo', 'uteis', 'responsavel_id', null, 'tipo', 'padrao')
  ) where id = v_tpl_m;

  -- workflow com etapa pendente (tipo deve sincronizar)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo M Pendente', v_tpl_m, 'ativo', 0, false, 'padrao')
    returning id into v_wf_m_pend;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf_m_pend, 0, 'Old0', 1, 'uteis', 'padrao', 'pendente')
    returning id into v_etapa_m_pend;

  -- workflow com etapa ativa no mesmo indice do template (discriminante: tipo NAO deve sincronizar)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo M Ativo', v_tpl_m, 'ativo', 0, false, 'padrao')
    returning id into v_wf_m_ativo;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em)
    values (v_wf_m_ativo, 0, 'Old0b', 1, 'uteis', 'padrao', 'ativo', now())
    returning id into v_etapa_m_ativo;

  -- workflow com escada mista: concluido (intocavel) + duas pendentes (ambas devem sincronizar,
  -- mas contar como 1 so evento por workflow)
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli1, 'Fluxo M Misto', v_tpl_m, 'ativo', 2, false, 'padrao')
    returning id into v_wf_m_mixed;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, concluido_em)
    values (v_wf_m_mixed, 0, 'Concl0', 9, 'uteis', 'padrao', 'concluido', '2026-01-01 10:00+00', '2026-01-02 10:00+00')
    returning id into v_etapa_m_concl;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf_m_mixed, 1, 'Old1', 1, 'uteis', 'padrao', 'pendente')
    returning id into v_etapa_m_mixed1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf_m_mixed, 2, 'Old2', 1, 'uteis', 'padrao', 'pendente')
    returning id into v_etapa_m_mixed2;

  -- fluxo de OUTRO tenant (v_ws2) cujo template_id coincide com o template de v_ws (poisoned FK
  -- via insert direto, bypass de app) -- nao pode ser tocado pela propagacao de v_ws
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws2, v_other, v_cli_poison_a, 'Fluxo Poison Prop', v_tpl_m, 'ativo', 0, false, 'padrao')
    returning id into v_wf_poison_prop;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status)
    values (v_wf_poison_prop, 0, 'PoisonEtapa', 1, 'uteis', 'padrao', 'pendente')
    returning id into v_etapa_poison_prop;

  select nome, prazo_dias, tipo_prazo, tipo, responsavel_id, status, iniciado_em, concluido_em
    into v_snap_concl_nome, v_snap_concl_prazo, v_snap_concl_tp, v_snap_concl_tipo,
         v_snap_concl_resp, v_snap_concl_status, v_snap_concl_ini, v_snap_concl_conc
    from workflow_etapas where id = v_etapa_m_concl;
  select nome, prazo_dias, tipo_prazo, tipo, responsavel_id
    into v_snap_poison_nome, v_snap_poison_prazo, v_snap_poison_tp, v_snap_poison_tipo, v_snap_poison_resp
    from workflow_etapas where id = v_etapa_poison_prop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform propagate_template_to_workflows(v_tpl_m);
  perform set_config('app.suppress_workflow_events', '0', true);

  -- (m-3) tipo sincroniza em 'pendente'
  select * into r from workflow_etapas where id = v_etapa_m_pend;
  assert r.nome = 'T0' and r.prazo_dias = 3 and r.tipo_prazo = 'corridos',
    'etapa pendente deve sincronizar nome/prazo_dias/tipo_prazo';
  assert r.tipo = 'aprovacao_cliente',
    format('tipo da etapa pendente deveria sincronizar para aprovacao_cliente, veio %s', r.tipo);

  -- (m-3) tipo NAO sincroniza em 'ativo', mesmo indice do template com tipo diferente (discriminante)
  select * into r from workflow_etapas where id = v_etapa_m_ativo;
  assert r.nome = 'T0' and r.prazo_dias = 3 and r.tipo_prazo = 'corridos',
    'etapa ativa deve sincronizar nome/prazo_dias/tipo_prazo mesmo sem tocar tipo';
  assert r.tipo = 'padrao',
    format('tipo NAO deve sincronizar em etapa ativa (template tem aprovacao_cliente), veio %s', r.tipo);

  -- (m-2) etapa concluida completamente intocada
  select * into r from workflow_etapas where id = v_etapa_m_concl;
  assert r.nome = v_snap_concl_nome and r.prazo_dias = v_snap_concl_prazo and r.tipo_prazo = v_snap_concl_tp
     and r.tipo = v_snap_concl_tipo and r.responsavel_id is not distinct from v_snap_concl_resp
     and r.status = v_snap_concl_status and r.iniciado_em = v_snap_concl_ini and r.concluido_em = v_snap_concl_conc,
    'etapa concluida deve permanecer byte-identica apos a propagacao';

  select * into r from workflow_etapas where id = v_etapa_m_mixed1;
  assert r.nome = 'T1' and r.prazo_dias = 4 and r.tipo_prazo = 'uteis', 'etapa mista pendente 1 deve sincronizar';
  select * into r from workflow_etapas where id = v_etapa_m_mixed2;
  assert r.nome = 'T2' and r.prazo_dias = 5 and r.tipo_prazo = 'uteis', 'etapa mista pendente 2 deve sincronizar';

  -- (m-1) 1 evento por workflow tocado, nao por etapa
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_m_pend and event_type = 'template_propagado';
  assert v_cnt = 1, 'fluxo pendente deve gerar exatamente 1 evento template_propagado';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_m_ativo and event_type = 'template_propagado';
  assert v_cnt = 1, 'fluxo ativo deve gerar exatamente 1 evento template_propagado';
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_m_mixed and event_type = 'template_propagado';
  assert v_cnt = 1, 'fluxo misto com 2 etapas alteradas deve gerar so 1 evento (por fluxo, nao por etapa)';

  select metadata->>'etapas_atualizadas' into v_txt from workflow_events
    where workflow_id = v_wf_m_mixed and event_type = 'template_propagado';
  assert v_txt::int = 2, format('etapas_atualizadas deve contar as 2 etapas realmente alteradas, veio %s', v_txt);

  -- nenhum ruido de trigger de linha vazou durante a propagacao (GUC suprimida)
  select count(*) into v_cnt from workflow_events
    where workflow_id in (v_wf_m_pend, v_wf_m_ativo, v_wf_m_mixed)
      and event_type in ('etapa_editada', 'etapa_iniciada', 'etapa_concluida', 'etapa_revertida', 'fluxo_editado');
  assert v_cnt = 0, 'trigger de linha nao deveria ter gravado nada durante a propagacao (GUC suprimida)';

  -- (m-4) fluxo de outro tenant com template_id coincidente nao e tocado
  select count(*) into v_cnt from workflow_events
    where workflow_id = v_wf_poison_prop and event_type = 'template_propagado';
  assert v_cnt = 0, 'fluxo de outro tenant com template_id coincidente NAO pode ser tocado';

  select * into r from workflow_etapas where id = v_etapa_poison_prop;
  assert r.nome = v_snap_poison_nome and r.prazo_dias = v_snap_poison_prazo and r.tipo_prazo = v_snap_poison_tp
     and r.tipo = v_snap_poison_tipo and r.responsavel_id is not distinct from v_snap_poison_resp,
    'etapa do fluxo envenenado deve ficar byte-identica apos a propagacao de outro tenant';

  raise notice 'PASS workflow_events';
end $$;
rollback;
