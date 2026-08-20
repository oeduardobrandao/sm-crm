-- Valida supabase/migrations/20260819000001_workflow_template_migration.sql.
-- Casos:
--   (a) migração feliz: escada substituída, statuses derivados, workflow atualizado, audit_log gravado
--   (b) remap de propriedade por nome+tipo (case-insensitive, trim), valor órfão apagado
--   (c) conflito UNIQUE(post_id, definition): valor já existente no destino vence
--   (c2) duas definições de origem casando com a MESMA de destino: menor display_order vence,
--        sem unique_violation (o INSERT+ON CONFLICT resolve; um UPDATE simples estouraria)
--   (c3) tipos de opção (select/multiselect/status) NUNCA remapeiam, mesmo com nome igual
--   (d) workflow_select_options do template origem são apagadas
--   (e) isolamento: usuário de outra conta não migra
--   (e2) guarda de concorrência: p_expected_template_id divergente = workflow_changed
--   (e3) migrar para o próprio template = same_template (no-op destrutivo barrado)
--   (e4) data_limite não-ISO = invalid_etapa (contrato de erro, não cast cru)
--   (e5) responsavel_id não-numérico = invalid_responsavel (contrato de erro, não cast cru)
--   (f) validação falha = rollback total (escada antiga intacta)
--   (g) adoção: workflow com template_id null migra sem tocar em propriedades
--   (h) portal_approvals legadas arquivadas no metadata antes da cascata
--   (i) etapa ativa nova dispara notify_step_activated (via UPDATE) para outro membro
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cli bigint;
  v_wf bigint; v_wf_adopt bigint;
  v_etapa_old bigint;
  v_tpl_a bigint; v_tpl_b bigint;
  v_def_a_tema bigint; v_def_a_tema_dup bigint; v_def_a_briefing bigint; v_def_a_formato bigint;
  v_def_b_tema bigint; v_def_b_formato bigint;
  v_post1 bigint; v_post2 bigint;
  v_new_etapas jsonb := jsonb_build_array(
    jsonb_build_object('nome','Roteiro','prazo_dias',2,'tipo_prazo','uteis','responsavel_id',null,'tipo','padrao','data_limite',null),
    jsonb_build_object('nome','Design','prazo_dias',3,'tipo_prazo','corridos','responsavel_id',null,'tipo','padrao','data_limite',null),
    jsonb_build_object('nome','Aprovação','prazo_dias',2,'tipo_prazo','corridos','responsavel_id',null,'tipo','aprovacao_cliente','data_limite','2026-09-10')
  );
  v_blocked boolean;
  v_cnt int;
  v_meta jsonb;
  r record;
begin
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');
  insert into auth.users (id) values (v_owner), (v_admin), (v_other);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_admin, v_ws, 'admin'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_admin;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_owner, 'Cliente A', 'CA', '#000') returning id into v_cli;

  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template A', '[{"nome":"Antiga 1","prazo_dias":1,"tipo_prazo":"corridos"}]', 'padrao')
    returning id into v_tpl_a;
  insert into workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (v_ws, v_owner, 'Template B', '[{"nome":"Roteiro","prazo_dias":2,"tipo_prazo":"uteis"}]', 'padrao')
    returning id into v_tpl_b;

  -- propriedades:
  --   'Tema' (text, do=0) e 'Tema' duplicada (text, do=2) em A casam ambas com ' tema ' (text) em B  -> (c2)
  --   'Briefing' (text) não existe em B                                                              -> (b) órfã
  --   'Formato' (select) existe com o MESMO nome em A e B, mas select nunca casa                      -> (c3)
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Tema', 'text', 0) returning id into v_def_a_tema;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Tema', 'text', 2) returning id into v_def_a_tema_dup;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_a, v_ws, 'Briefing', 'text', 1) returning id into v_def_a_briefing;
  insert into template_property_definitions (template_id, conta_id, name, type, config, display_order)
    values (v_tpl_a, v_ws, 'Formato', 'select', '{"options":[{"id":"11111111-1111-1111-1111-111111111111","label":"Feed","color":"#000"}]}', 3)
    returning id into v_def_a_formato;
  insert into template_property_definitions (template_id, conta_id, name, type, display_order)
    values (v_tpl_b, v_ws, ' tema ', 'text', 0) returning id into v_def_b_tema;
  insert into template_property_definitions (template_id, conta_id, name, type, config, display_order)
    values (v_tpl_b, v_ws, 'Formato', 'select', '{"options":[{"id":"22222222-2222-2222-2222-222222222222","label":"Feed","color":"#000"}]}', 1)
    returning id into v_def_b_formato;

  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Fluxo A', v_tpl_a, 'ativo', 0, false, 'padrao')
    returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf, 0, 'Antiga 1', 1, 'corridos', 'ativo', now()) returning id into v_etapa_old;

  -- (h) linha legada de portal_approvals pendurada na etapa antiga
  insert into portal_approvals (workflow_etapa_id, token, action, comentario)
    values (v_etapa_old, 'tok-legado', 'aprovado', 'ok do cliente');

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'Post 1', 'feed', 'rascunho') returning id into v_post1;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'Post 2', 'feed', 'aprovado_cliente') returning id into v_post2;

  -- (b) Tema deve migrar; Briefing deve ser descartado
  -- (c2) post1 tem valor nas DUAS 'Tema' de A; a de menor display_order ('"saude"') vence
  -- (c3) valor de select aponta para option id do template A; nunca migra
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_post1, v_def_a_tema, '"saude"'),
           (v_post1, v_def_a_tema_dup, '"dup-perdedor"'),
           (v_post1, v_def_a_briefing, '"texto"'),
           (v_post1, v_def_a_formato, '"11111111-1111-1111-1111-111111111111"');
  -- (c) post2 já tem valor na definição destino: o do destino vence
  insert into post_property_values (post_id, property_definition_id, value)
    values (v_post2, v_def_a_tema, '"origem"'), (v_post2, v_def_b_tema, '"destino"');
  -- (d) select option on-the-fly pendurada em definição do template origem
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (v_wf, v_def_a_formato, v_ws, 'Opcao X');

  -- (e) outra conta não pode migrar
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%workflow_not_found%', format('esperava workflow_not_found, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'outra conta deve ser bloqueada';

  -- (e2) guarda de concorrência: expected divergente
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', null);
  exception when others then
    assert sqlerrm like '%workflow_changed%', format('esperava workflow_changed, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'expected_template_id divergente deve falhar';

  -- (e3) migrar para o próprio template é barrado
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_a, v_new_etapas, 0, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%same_template%', format('esperava same_template, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'migrar para o próprio template deve falhar';

  -- (e4) data_limite não-ISO vira invalid_etapa, não erro cru de cast
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b,
      jsonb_build_array(jsonb_build_object('nome','X','prazo_dias',1,'tipo_prazo','corridos','responsavel_id',null,'tipo','padrao','data_limite','data-invalida')),
      0, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_etapa%', format('esperava invalid_etapa, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'data_limite invalida deve falhar com codigo estavel';

  -- (e5) responsavel_id não-numérico vira invalid_responsavel
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b,
      jsonb_build_array(jsonb_build_object('nome','X','prazo_dias',1,'tipo_prazo','corridos','responsavel_id','abc','tipo','padrao','data_limite',null)),
      0, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_responsavel%', format('esperava invalid_responsavel, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'responsavel_id invalido deve falhar com codigo estavel';

  -- (f) validação falha = rollback total
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 99, 'padrao', v_tpl_a);
  exception when others then
    assert sqlerrm like '%invalid_active_ordem%', format('esperava invalid_active_ordem, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'active_ordem fora do range deve falhar';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 1, 'escada antiga deve continuar intacta após falha';
  select count(*) into v_cnt from post_property_values where post_id = v_post1;
  assert v_cnt = 4, 'valores intactos após falha';

  -- (a) migração feliz
  perform migrate_workflow_template(v_wf, v_tpl_b, v_new_etapas, 1, 'padrao', v_tpl_a);

  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf;
  assert v_cnt = 3, format('escada nova deve ter 3 etapas, tem %s', v_cnt);
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 0;
  assert r.status = 'concluido' and r.iniciado_em is null and r.concluido_em is null,
    'etapa anterior: concluida com datas nulas';
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 1;
  assert r.status = 'ativo' and r.iniciado_em is not null, 'etapa ativa com iniciado_em';
  select * into r from workflow_etapas where workflow_id = v_wf and ordem = 2;
  assert r.status = 'pendente' and r.data_limite = date '2026-09-10', 'pendente com data_limite do payload';

  select * into r from workflows where id = v_wf;
  assert r.template_id = v_tpl_b and r.etapa_atual = 1 and r.modo_prazo = 'padrao', 'workflow atualizado';

  -- (b)/(c2) valores: Tema migrou com o valor da definição de menor display_order
  select count(*) into v_cnt from post_property_values
    where post_id = v_post1 and property_definition_id = v_def_b_tema and value = '"saude"';
  assert v_cnt = 1, 'Tema de post1 deve migrar com o valor da def de menor display_order';
  select count(*) into v_cnt from post_property_values where property_definition_id = v_def_a_briefing;
  assert v_cnt = 0, 'Briefing (sem par) deve ser apagado';

  -- (c) conflito: valor do destino vence, o de origem some
  select count(*) into v_cnt from post_property_values
    where post_id = v_post2 and property_definition_id = v_def_b_tema and value = '"destino"';
  assert v_cnt = 1, 'valor pré-existente no destino vence';
  select count(*) into v_cnt from post_property_values pv
    join template_property_definitions d on d.id = pv.property_definition_id
    where d.template_id = v_tpl_a;
  assert v_cnt = 0, 'nenhum valor pode continuar apontando para definições de A';

  -- (c3) select nunca remapeia, mesmo com nome igual
  select count(*) into v_cnt from post_property_values
    where post_id = v_post1 and property_definition_id = v_def_b_formato;
  assert v_cnt = 0, 'valor de select não pode migrar (option ids são por template)';

  -- (d) select options do template origem apagadas
  select count(*) into v_cnt from workflow_select_options where workflow_id = v_wf;
  assert v_cnt = 0, 'select options do template origem devem ser apagadas';

  -- (h) + audit log: metadata com perdas e portal_approvals legadas
  select metadata into v_meta from audit_log
    where action = 'workflow.template_migrated' and resource_id = v_wf::text and conta_id = v_ws;
  assert v_meta is not null, 'audit_log deve registrar a migração';
  assert v_meta->'dropped_property_names' ? 'Briefing', 'metadata: nomes descartados';
  assert v_meta->'dropped_property_names' ? 'Formato', 'metadata: select descartada';
  select count(*) into v_cnt from jsonb_array_elements(v_meta->'dropped_property_values') e
    where e->'value' = '"dup-perdedor"'::jsonb;
  assert v_cnt >= 1, 'metadata: valor perdedor do conflito (c2) preservado';
  select count(*) into v_cnt from jsonb_array_elements(v_meta->'legacy_portal_approvals') e
    where e->>'comentario' = 'ok do cliente';
  assert v_cnt = 1, 'metadata: portal_approvals legada arquivada';
  select count(*) into v_cnt from portal_approvals where workflow_etapa_id = v_etapa_old;
  assert v_cnt = 0, 'cascata apagou a linha legada (por isso o arquivo no metadata)';

  -- (i) notificação step_activated para o admin (ator v_owner é excluído)
  select count(*) into v_cnt from notifications
    where workspace_id = v_ws and user_id = v_admin and type = 'step_activated';
  assert v_cnt >= 1, 'etapa ativa nova deve notificar (ativação via UPDATE)';

  -- (g) adoção: fluxo sem template
  insert into workflows (conta_id, user_id, cliente_id, titulo, template_id, status, etapa_atual, recorrente, modo_prazo)
    values (v_ws, v_owner, v_cli, 'Fluxo do zero', null, 'ativo', 0, false, 'padrao')
    returning id into v_wf_adopt;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status, iniciado_em)
    values (v_wf_adopt, 0, 'Solta', 1, 'corridos', 'ativo', now());
  perform migrate_workflow_template(v_wf_adopt, v_tpl_b, v_new_etapas, 0, 'padrao', null);
  select * into r from workflows where id = v_wf_adopt;
  assert r.template_id = v_tpl_b, 'adoção deve setar template_id';
  select count(*) into v_cnt from workflow_etapas where workflow_id = v_wf_adopt;
  assert v_cnt = 3, 'adoção substitui a escada';

  -- workflow concluído não migra
  update workflows set status = 'concluido' where id = v_wf_adopt;
  v_blocked := false;
  begin
    perform migrate_workflow_template(v_wf_adopt, v_tpl_b, v_new_etapas, 0, 'padrao', v_tpl_b);
  exception when others then
    assert sqlerrm like '%workflow_not_active%', format('esperava workflow_not_active, veio: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'fluxo concluído não deve migrar';

  raise notice 'PASS migrate_workflow_template';
end $$;
rollback;
