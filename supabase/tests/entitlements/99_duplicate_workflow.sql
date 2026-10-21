-- supabase/tests/entitlements/99_duplicate_workflow.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- duplicate_workflow (20261002000021). Cobre:
-- 99w.0 guarda de colunas: toda coluna de workflows, workflow_etapas e
--       workflow_select_options esta classificada
-- 99w.1 fluxo: titulo, campos, etapas no mesmo estado, posicao logo depois
-- 99w.2 posts: todos copiados sem sufixo, mesma ordem, status pelo modo, midia
-- 99w.3 opcoes: option_id novo e valores select/multiselect remapeados;
--       texto que nao e opcao fica igual
-- 99w.4 isolamento e grants
-- 99w.5 limite de fluxos ativos desfaz tudo
-- 99w.6 erros de acesso: papel sem entregas:editar -> permission_denied;
--       sem workspace ativo -> workspace_not_found

create or replace function pg_temp.dw_env(
  out ws uuid, out usr uuid, out cli bigint, out tmpl bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_templates (user_id, conta_id, nome, etapas)
    values (usr, ws, 'T', '[]'::jsonb) returning id into tmpl;
end $$;

create or replace function pg_temp.dw_as(p_usr uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 99w.0 guarda de colunas. Se falhar: a coluna nova precisa entrar em
-- duplicate_workflow (copiar ou deixar no default de proposito) E na lista abaixo.
begin;
do $$
declare v_missing text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workflows'
     and column_name not in (
       -- copiadas
       'conta_id','cliente_id','titulo','template_id','status','etapa_atual',
       'recorrente','position','modo_prazo','link_notion','link_drive','concluido_em',
       'plataformas',  -- 20261010100005
       -- definidas pela copia
       'user_id','created_via',
       -- geradas pelo banco
       'id','created_at');
  assert v_missing is null, format('workflows tem coluna nao classificada em duplicate_workflow: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workflow_etapas'
     and column_name not in (
       -- copiadas
       'ordem','nome','prazo_dias','tipo_prazo','responsavel_id','tipo','status',
       'iniciado_em','concluido_em','data_limite',
       -- definidas pela copia
       'workflow_id',
       -- geradas pelo banco
       'id');
  assert v_missing is null, format('workflow_etapas tem coluna nao classificada em duplicate_workflow: %s', v_missing);

  select string_agg(column_name, ', ' order by column_name) into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workflow_select_options'
     and column_name not in (
       -- copiadas
       'property_definition_id','label','color',
       -- definidas pela copia
       'workflow_id','conta_id',
       -- geradas pelo banco (option_id novo e remapeado nos valores dos posts)
       'id','option_id','created_at');
  assert v_missing is null, format('workflow_select_options tem coluna nao classificada em duplicate_workflow: %s', v_missing);
  raise notice 'PASS 99w.0';
end $$;
rollback;

begin;
select et_grant_hosted_parity();
do $$
declare
  e record; wf bigint; wf_other bigint; v_new bigint; r record; v_n int;
  p1 bigint; p2 bigint; f1 bigint; pa1 bigint; pa2 bigint; pr1 bigint; pr2 bigint;
  d_sel bigint; d_multi bigint; d_txt bigint;
  o1 uuid; o2 uuid; n1 uuid; n2 uuid;
  v_val jsonb;
begin
  e := pg_temp.dw_env();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, template_id,
                         etapa_atual, recorrente, position, modo_prazo, link_notion)
    values (e.usr, e.ws, e.cli, 'Mensal', 'ativo', e.tmpl, 1, true, 3, 'data_fixa', 'https://n.so/x')
    returning id into wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (e.usr, e.ws, e.cli, 'Outro', 'ativo', 4) returning id into wf_other;

  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, concluido_em, data_limite)
    values (wf, 0, 'Copy', 2, 'corridos', 'padrao', 'concluido', timestamptz '2026-10-01 10:00+00', date '2026-10-01');
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, iniciado_em, data_limite)
    values (wf, 1, 'Aprovação', 3, 'uteis', 'aprovacao_cliente', 'ativo', timestamptz '2026-10-01 10:00+00', date '2026-10-06');

  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status, scheduled_at)
    values (wf, e.ws, 'Post 1', 0, 'agendado', timestamptz '2026-11-01 12:00+00') returning id into p1;
  insert into workflow_posts (workflow_id, conta_id, titulo, ordem, status)
    values (wf, e.ws, 'Post 2', 1, 'enviado_cliente') returning id into p2;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (e.ws, 'k1', 'f1', 'image', 'image/png', 10) returning id into f1;
  insert into post_file_links (post_id, file_id, conta_id, sort_order) values (p1, f1, e.ws, 0);

  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Formato', 'select') returning id into d_sel;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Tags', 'multiselect') returning id into d_multi;
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (e.tmpl, e.ws, 'Nota', 'text') returning id into d_txt;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    values (wf, d_sel, e.ws, 'Vídeo', '#f00') returning option_id into o1;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (wf, d_multi, e.ws, 'Promo') returning option_id into o2;
  insert into post_property_values (post_id, property_definition_id, value) values
    (p1, d_sel, to_jsonb(o1::text)),
    (p1, d_multi, jsonb_build_array(o2::text, 'opcao-do-template')),
    (p1, d_txt, to_jsonb(o1::text));   -- texto que parece uuid: nao remapeia

  -- processos avulsos no mesmo espaco de indices do quadro (position do original = 3)
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = e.ws);
  insert into workflow_posts (conta_id, cliente_id, titulo) values (e.ws, e.cli, 'Avulso A') returning id into pa1;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (e.ws, e.cli, 'Avulso B') returning id into pa2;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (e.ws, pa1, '0|Copy|padrao', 4) returning id into pr1;
  insert into post_processes (conta_id, post_id, assinatura, board_position) values (e.ws, pa2, '0|Copy|padrao', 3) returning id into pr2;

  perform pg_temp.dw_as(e.usr);
  v_new := duplicate_workflow(wf, false);
  execute 'reset role';

  -- 99w.1
  select * into r from workflows where id = v_new;
  assert r.titulo = 'Mensal (cópia)', format('titulo: %s', r.titulo);
  assert r.cliente_id = e.cli and r.template_id = e.tmpl and r.status = 'ativo'
     and r.etapa_atual = 1 and r.recorrente and r.modo_prazo = 'data_fixa'
     and r.link_notion = 'https://n.so/x' and r.user_id = e.usr and r.created_via = 'human', 'campos do fluxo';
  assert r.position = 4, format('position do clone: %s', r.position);
  assert (select position from workflows where id = wf_other) = 5, 'fluxo seguinte empurrado';
  assert (select position from workflows where id = wf) = 3, 'original intocado';
  assert (select board_position from post_processes where id = pr1) = 5, 'processo posterior empurrado';
  assert (select board_position from post_processes where id = pr2) = 3, 'processo anterior/igual intocado';
  select count(*) into v_n from workflow_etapas where workflow_id = v_new;
  assert v_n = 2, format('etapas: %s', v_n);
  select * into r from workflow_etapas where workflow_id = v_new and ordem = 1;
  assert r.status = 'ativo' and r.tipo = 'aprovacao_cliente' and r.data_limite = date '2026-10-06'
     and r.iniciado_em = timestamptz '2026-10-01 10:00+00', 'etapa ativa no mesmo estado';
  assert (select status from workflow_etapas where workflow_id = v_new and ordem = 0) = 'concluido', 'etapa concluida';
  raise notice 'PASS 99w.1';

  -- 99w.2
  select count(*) into v_n from workflow_posts where workflow_id = v_new;
  assert v_n = 2, format('posts: %s', v_n);
  select * into r from workflow_posts where workflow_id = v_new and ordem = 0;
  assert r.titulo = 'Post 1', format('sem sufixo: %s', r.titulo);
  assert r.status = 'aprovado_cliente' and r.scheduled_at = timestamptz '2026-11-01 12:00+00', 'agendado -> aprovado, data mantida';
  assert r.board_ordem is null, 'sem ranque';
  assert exists (select 1 from post_file_links where post_id = r.id and file_id = f1), 'midia linkada';
  assert (select status from workflow_posts where workflow_id = v_new and ordem = 1) = 'enviado_cliente', 'status mantido';
  raise notice 'PASS 99w.2';

  -- 99w.3
  select option_id into n1 from workflow_select_options where workflow_id = v_new and property_definition_id = d_sel;
  select option_id into n2 from workflow_select_options where workflow_id = v_new and property_definition_id = d_multi;
  assert n1 is not null and n1 <> o1 and n2 is not null and n2 <> o2, 'option_ids novos';
  assert (select label from workflow_select_options where option_id = n1) = 'Vídeo'
     and (select color from workflow_select_options where option_id = n1) = '#f00', 'label/cor';
  select value into v_val from post_property_values
   where property_definition_id = d_sel and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = to_jsonb(n1::text), format('select remapeado: %s', v_val);
  select value into v_val from post_property_values
   where property_definition_id = d_multi and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = jsonb_build_array(n2::text, 'opcao-do-template'), format('multiselect remapeado: %s', v_val);
  select value into v_val from post_property_values
   where property_definition_id = d_txt and post_id = (select id from workflow_posts where workflow_id = v_new and ordem = 0);
  assert v_val = to_jsonb(o1::text), format('texto intocado: %s', v_val);
  -- o original continua com as opcoes antigas
  assert (select value from post_property_values where post_id = p1 and property_definition_id = d_sel) = to_jsonb(o1::text), 'original intocado';
  raise notice 'PASS 99w.3';

  -- modo rascunho
  perform pg_temp.dw_as(e.usr);
  v_new := duplicate_workflow(wf, true);
  execute 'reset role';
  assert not exists (select 1 from workflow_posts where workflow_id = v_new and status <> 'rascunho'), 'tudo rascunho';
  raise notice 'PASS 99w.2b';
end $$;
rollback;

-- 99w.4 isolamento e grants
begin;
select et_grant_hosted_parity();
do $$
declare e record; o record; wf bigint; v_raised boolean; d_forged bigint; v_new bigint;
begin
  e := pg_temp.dw_env();
  o := pg_temp.dw_env();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (e.usr, e.ws, e.cli, 'F', 'ativo') returning id into wf;
  -- linha forjada: dona da OUTRA conta apontando para o fluxo de e
  insert into template_property_definitions (template_id, conta_id, name, type)
    values (o.tmpl, o.ws, 'Forjada', 'select') returning id into d_forged;
  insert into workflow_select_options (workflow_id, property_definition_id, conta_id, label)
    values (wf, d_forged, o.ws, 'Forjada');
  perform pg_temp.dw_as(o.usr);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'not_found', format('outra conta: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'outra conta duplicou o fluxo';
  -- o dono duplica: a opcao forjada de outra conta nao vem junto
  perform pg_temp.dw_as(e.usr);
  v_new := duplicate_workflow(wf, false);
  execute 'reset role';
  assert not exists (select 1 from workflow_select_options where workflow_id = v_new and label = 'Forjada'), 'opcao forjada copiada';
  assert not exists (select 1 from workflow_select_options where workflow_id = v_new and conta_id = o.ws), 'linha da outra conta copiada';
  assert not has_function_privilege('anon', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'anon tem EXECUTE';
  assert has_function_privilege('service_role', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'service_role sem EXECUTE';
  assert has_function_privilege('authenticated', 'public.duplicate_workflow(bigint, boolean)', 'EXECUTE'), 'authenticated sem EXECUTE';
  raise notice 'PASS 99w.4';
end $$;
rollback;

-- 99w.5 limite de fluxos ativos (max_active_workflows_per_client = 1)
begin;
select et_grant_hosted_parity();
do $$
declare e record; wf bigint; v_raised boolean;
begin
  e := pg_temp.dw_env();
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (e.ws, '{"max_active_workflows_per_client": 1}'::jsonb);
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (e.usr, e.ws, e.cli, 'F', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, status)
    values (wf, 0, 'E', 1, 'corridos', 'ativo');
  insert into workflow_posts (workflow_id, conta_id, titulo) values (wf, e.ws, 'P');
  perform pg_temp.dw_as(e.usr);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm like 'plan_limit_exceeded:max_active_workflows_per_client%', format('msg: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'limite nao barrou';
  assert (select count(*) from workflows where conta_id = e.ws) = 1, 'fluxo orfao';
  assert (select count(*) from workflow_posts where conta_id = e.ws) = 1, 'post orfao';
  raise notice 'PASS 99w.5';
end $$;
rollback;

-- 99w.6 erros de acesso dentro do proprio workspace
begin;
select et_grant_hosted_parity();
do $$
declare e record; wf bigint; v_role uuid; v_ver uuid; v_sem uuid; v_raised boolean;
begin
  e := pg_temp.dw_env();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (e.usr, e.ws, e.cli, 'F', 'ativo') returning id into wf;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (wf, e.ws, 'P');

  -- (a) membro do mesmo workspace com papel customizado so de leitura em entregas
  v_ver := gen_random_uuid();
  insert into auth.users (id) values (v_ver);
  insert into workspace_roles (conta_id, nome, permissions)
    values (e.ws, 'So ver', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_ver, e.ws, 'agent', v_role);
  update profiles set conta_id = e.ws, active_workspace_id = e.ws where id = v_ver;
  perform pg_temp.dw_as(v_ver);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'permission_denied', format('papel so ver: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'papel sem entregas:editar duplicou o fluxo';
  assert (select count(*) from workflows where conta_id = e.ws) = 1, 'nenhum fluxo criado (permission_denied)';
  assert (select count(*) from workflow_posts where conta_id = e.ws) = 1, 'nenhum post criado (permission_denied)';

  -- (b) membro sem workspace ativo
  v_sem := gen_random_uuid();
  insert into auth.users (id) values (v_sem);
  insert into workspace_members (user_id, workspace_id, role) values (v_sem, e.ws, 'owner');
  update profiles set conta_id = e.ws, active_workspace_id = null where id = v_sem;
  perform pg_temp.dw_as(v_sem);
  v_raised := false;
  begin
    perform duplicate_workflow(wf, false);
  exception when others then
    v_raised := true;
    assert sqlerrm = 'workspace_not_found', format('sem workspace ativo: %s', sqlerrm);
  end;
  execute 'reset role';
  assert v_raised, 'sem workspace ativo duplicou o fluxo';
  assert (select count(*) from workflows where conta_id = e.ws) = 1, 'nenhum fluxo criado (workspace_not_found)';
  raise notice 'PASS 99w.6';
end $$;
rollback;
