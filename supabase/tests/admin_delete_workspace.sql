\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- admin_delete_workspace / admin_delete_workspace_preview (migration 20261208000001): o Admin da
-- plataforma exclui um workspace inteiro. O workspace semeado aqui tem o que travaria um DELETE
-- ingênuo: destino de post `publicado` (post_targets_guard_delete), thread `geral`
-- (trg_post_comment_threads_geral_guard_delete), arquivo ligado a post (post_file_links ->
-- files RESTRICT), membro com papel customizado (wm_role_same_workspace RESTRICT), tarefa com
-- subtarefa e tag, conexão OAuth do MCP ativa e profiles apontando para ele (FK NO ACTION).

-- 1. ACL: só o service_role executa.
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.admin_delete_workspace(uuid, uuid)', 'execute'),
    'anon não pode executar admin_delete_workspace';
  assert not has_function_privilege('authenticated', 'public.admin_delete_workspace(uuid, uuid)', 'execute'),
    'authenticated não pode executar admin_delete_workspace';
  assert not has_function_privilege('authenticated', 'public.admin_delete_workspace_preview(uuid)', 'execute'),
    'authenticated não pode executar admin_delete_workspace_preview';
  assert has_function_privilege('service_role', 'public.admin_delete_workspace(uuid, uuid)', 'execute'),
    'service_role executa admin_delete_workspace';
  assert has_function_privilege('service_role', 'public.admin_delete_workspace_preview(uuid)', 'execute'),
    'service_role executa admin_delete_workspace_preview';
end $$;
rollback;

-- 2. Assinatura ativa recusa e não apaga nada; cancelada passa.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_ws uuid;
  v_status text;
  v_prev jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'dono-sub@x.test');
  insert into auth.users (id, email) values (v_admin, 'admin-sub@x.test');
  select id into v_ws from workspaces where created_by = v_owner;

  foreach v_status in array array['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'] loop
    delete from workspace_subscriptions where workspace_id = v_ws;
    insert into workspace_subscriptions (workspace_id, provider, status, stripe_subscription_id)
      values (v_ws, 'stripe', v_status, 'sub_test');
    v_prev := admin_delete_workspace_preview(v_ws);
    assert (v_prev->'subscription'->>'blocks')::boolean, format('preview deve bloquear %s', v_status);
    begin
      perform admin_delete_workspace(v_ws, v_admin);
      raise exception 'deveria recusar status %', v_status;
    exception when others then
      assert sqlerrm = 'active_subscription', format('esperava active_subscription para %s, veio %s', v_status, sqlerrm);
    end;
    assert exists (select 1 from workspaces where id = v_ws), 'workspace não pode sumir com assinatura ' || v_status;
  end loop;

  update workspace_subscriptions set status = 'canceled' where workspace_id = v_ws;
  v_prev := admin_delete_workspace_preview(v_ws);
  assert not (v_prev->'subscription'->>'blocks')::boolean, 'cancelada não bloqueia';
  perform admin_delete_workspace(v_ws, v_admin);
  assert not exists (select 1 from workspaces where id = v_ws), 'cancelada deixa excluir';
  assert not exists (select 1 from workspace_subscriptions where workspace_id = v_ws), 'assinatura sai em cascata';

  begin
    perform admin_delete_workspace(v_ws, v_admin);
    raise exception 'segunda exclusão deveria falhar';
  exception when others then
    assert sqlerrm = 'workspace_not_found', 'workspace inexistente = workspace_not_found, veio ' || sqlerrm;
  end;
end $$;
rollback;

-- 3. Workspace com dados reais: preview, exclusão, órfãos, profiles, filas e auditoria.
begin;
-- Paridade com prod: lá clientes.user_id tem FK ON DELETE CASCADE para auth.users (o banco local
-- não tem). É ela que faria o delete de um login levar clientes de outro workspace.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clientes'::regclass and contype = 'f' and confdeltype = 'c'
       and confrelid = 'auth.users'::regclass) then
    alter table public.clientes add constraint clientes_user_id_prod_parity_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end $$;
do $$
declare
  v_owner uuid := gen_random_uuid();   -- só neste workspace: login sai
  v_orphan uuid := gen_random_uuid();  -- membro com papel customizado, só aqui: login sai
  v_multi uuid := gen_random_uuid();   -- membro de outro workspace: login fica, profile reaponta
  v_admin uuid := gen_random_uuid();   -- admin da plataforma membro só daqui: login fica
  v_ex uuid := gen_random_uuid();      -- só membro daqui, mas criou cliente em outro workspace:
                                       -- clientes.user_id é ON DELETE CASCADE, então o login fica
  v_ws uuid; v_ws_multi uuid; v_ws_orphan_own uuid;
  v_role uuid; v_cli bigint; v_wf bigint; v_post bigint; v_file bigint; v_tarefa bigint; v_tag bigint;
  v_r2 text;
  v_prev jsonb; v_res jsonb; v_m jsonb;
  v_orphans uuid[];
  v_audit record;
  v_count bigint;
begin
  insert into auth.users (id, email) values (v_owner, 'dono@x.test');
  insert into auth.users (id, email) values (v_orphan, 'orfao@x.test');
  insert into auth.users (id, email) values (v_multi, 'multi@x.test');
  insert into auth.users (id, email) values (v_admin, 'admin@x.test');
  insert into auth.users (id, email) values (v_ex, 'ex@x.test');
  insert into platform_admins (user_id, email) values (v_admin, 'admin@x.test');

  select id into v_ws from workspaces where created_by = v_owner;
  select id into v_ws_multi from workspaces where created_by = v_multi;
  select id into v_ws_orphan_own from workspaces where created_by = v_orphan;
  update workspaces set plan_id = 'pro' where id = v_ws;
  insert into workspace_plan_overrides (workspace_id, resource_overrides)
    values (v_ws, '{"max_team_members": 50}'::jsonb);

  -- o órfão e o admin só participam do workspace excluído
  delete from workspace_members where user_id in (v_orphan, v_admin, v_ex);

  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Papel customizado', '{"entregas":"ver"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id) values (v_orphan, v_ws, 'agent', v_role);
  insert into workspace_members (user_id, workspace_id, role, joined_at)
    values (v_multi, v_ws, 'agent', now() - interval '1 day');
  insert into workspace_members (user_id, workspace_id, role) values (v_admin, v_ws, 'admin');
  insert into workspace_members (user_id, workspace_id, role) values (v_ex, v_ws, 'agent');
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws_multi, v_ex, 'Cliente de outro workspace', 'OW', '#111');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_orphan, v_multi, v_admin);

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_owner, 'Cliente', 'CL', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_owner, 'Fluxo', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, published_at)
    values (v_wf, v_ws, 'Publicado', 'feed', 'postado', 'instagram', now()) returning id into v_post;
  update post_targets set status = 'publicado', published_at = now() where post_id = v_post;
  if not exists (select 1 from post_targets where post_id = v_post and status = 'publicado') then
    insert into post_targets (conta_id, post_id, platform, status, published_at)
      values (v_ws, v_post, 'instagram', 'publicado', now());
  end if;
  if not exists (select 1 from post_comment_threads where post_id = v_post and field = 'geral') then
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
      values (v_post, v_ws, '', v_owner, 'geral');
  end if;

  v_r2 := 'contas/' || v_ws || '/files/' || gen_random_uuid() || '.jpg';
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, v_r2, 'foto.jpg', 'image', 'image/jpeg', 10) returning id into v_file;
  insert into post_file_links (conta_id, post_id, file_id, origin, sort_order)
    values (v_ws, v_post, v_file, 'manual', 0);

  insert into tarefas (conta_id, user_id, titulo) values (v_ws, v_owner, 'Tarefa') returning id into v_tarefa;
  insert into subtarefas (tarefa_id, conta_id, titulo) values (v_tarefa, v_ws, 'Sub');
  insert into tarefa_tags (conta_id, nome, cor) values (v_ws, 'Urgente', '#f00') returning id into v_tag;
  insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (v_tarefa, v_tag, v_ws);

  insert into mcp_oauth_grants (user_id, client_id, conta_id) values (v_owner, 'client-test', v_ws);

  -- preview
  v_prev := admin_delete_workspace_preview(v_ws);
  assert v_prev->'subscription' = 'null'::jsonb, 'sem assinatura: subscription nulo';
  assert (v_prev->'counts'->>'clientes')::int = 1, 'preview conta 1 cliente';
  assert (v_prev->'counts'->>'posts')::int = 1, 'preview conta 1 post';
  assert (v_prev->'counts'->>'arquivos')::int = 1, 'preview conta 1 arquivo';
  assert (v_prev->'counts'->>'membros')::int = 5, 'preview conta 5 membros';
  assert v_prev->'members'->0->>'user_id' = v_owner::text, 'dono vem primeiro';
  for v_m in select * from jsonb_array_elements(v_prev->'members') loop
    assert (v_m->>'login_deleted')::boolean = ((v_m->>'user_id')::uuid in (v_owner, v_orphan)),
      format('login_deleted errado para %s', v_m->>'email');
  end loop;

  -- exclusão
  v_res := admin_delete_workspace(v_ws, v_admin);
  select array_agg(x::uuid order by x) into v_orphans from jsonb_array_elements_text(v_res->'orphan_user_ids') x;
  assert v_orphans = (select array_agg(u order by u) from unnest(array[v_owner, v_orphan]) u),
    'órfãos = dono e membro sem outro workspace, veio ' || (v_res->'orphan_user_ids')::text;

  assert not exists (select 1 from workspaces where id = v_ws), 'workspace sumiu';
  assert not exists (select 1 from clientes where conta_id = v_ws), 'clientes sumiram';
  assert not exists (select 1 from workflow_posts where conta_id = v_ws), 'posts sumiram';
  assert not exists (select 1 from post_targets where conta_id = v_ws), 'destinos sumiram';
  assert not exists (select 1 from files where conta_id = v_ws), 'arquivos sumiram';
  assert not exists (select 1 from tarefas where conta_id = v_ws), 'tarefas sumiram';
  assert not exists (select 1 from workspace_roles where conta_id = v_ws), 'papéis sumiram';
  assert not exists (select 1 from workspace_members where workspace_id = v_ws), 'membros sumiram';
  assert not exists (select 1 from mcp_oauth_grants where conta_id = v_ws), 'grants sumiram';
  assert exists (select 1 from file_deletions where r2_key = v_r2), 'objeto do R2 entrou na fila de exclusão';
  -- Nenhuma tabela de public guarda linha do workspace, com ou sem FK (audit_log vira nulo).
  for v_m in
    select to_jsonb(x) from (
      select format('%I.%I', table_schema, table_name) as t, column_name as c
        from information_schema.columns
       where table_schema = 'public' and column_name in ('conta_id', 'workspace_id')
         and data_type = 'uuid' and table_name <> 'profiles'
         and table_name in (select table_name from information_schema.tables
                             where table_schema = 'public' and table_type = 'BASE TABLE')) x
  loop
    execute format('select count(*) from %s where %I = $1', v_m->>'t', v_m->>'c') into v_count using v_ws;
    assert v_count = 0, format('%s ainda tem %s linha(s) do workspace', v_m->>'t', v_count);
  end loop;

  assert exists (select 1 from workspaces where id = v_ws_multi), 'outro workspace do membro fica';
  assert exists (select 1 from workspaces where id = v_ws_orphan_own), 'workspace sem membros de outro usuário fica';
  assert (select active_workspace_id from profiles where id = v_multi) = v_ws_multi, 'membro multi reapontado';
  assert (select conta_id from profiles where id = v_multi) = v_ws_multi, 'conta_id do multi reapontado';
  assert (select active_workspace_id from profiles where id = v_orphan) is null, 'órfão fica sem workspace até o login sair';
  assert (select active_workspace_id from profiles where id = v_admin) is null, 'admin sem outro workspace fica nulo';
  assert exists (select 1 from auth.users where id = v_owner), 'a RPC não apaga logins (a function apaga depois)';
  assert exists (select 1 from clientes where conta_id = v_ws_multi and user_id = v_ex),
    'cliente do ex-membro em outro workspace continua';
  assert not admin_delete_workspace_login_deletable(v_ex, v_ws, true), 'ex-membro com dado em outro workspace mantém o login';
  assert admin_delete_workspace_login_deletable(v_owner, v_ws, true), 'dono só deste workspace perde o login';

  select * into v_audit from audit_log where action = 'admin-delete-workspace' and resource_id = v_ws::text;
  assert found, 'auditoria gravada';
  assert v_audit.conta_id is null, 'conta_id da auditoria vira nulo (ON DELETE SET NULL)';
  assert v_audit.actor_user_id = v_admin, 'auditoria guarda o admin';
  assert v_audit.metadata->>'owner_email' = 'dono@x.test', 'auditoria guarda o e-mail do dono';
  assert (v_audit.metadata->>'logins_to_delete')::int = 2, 'auditoria conta os logins a apagar';
end $$;
rollback;
