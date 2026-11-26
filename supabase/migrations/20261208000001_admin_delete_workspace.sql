-- Excluir workspace pelo Admin da plataforma (platform-admin `delete-workspace-preview` e
-- `delete-workspace`). Duas RPCs, EXECUTE só do service_role:
--
-- admin_delete_workspace_preview(p_conta): leitura. Nome, contagens do que some, o bloqueio de
--   cobrança pelo espelho (workspace_subscriptions) e cada membro com `login_deleted` (não
--   participa de outro workspace e não é admin da plataforma). A function confere a cobrança ao
--   vivo na Stripe / no Pagar.me antes de excluir; o espelho aqui é só a primeira barreira.
--
-- admin_delete_workspace(p_conta, p_actor): apaga o workspace inteiro numa transação e devolve
--   os user_ids cujo login a function apaga depois (auth.admin.deleteUser, um por um, fora da
--   transação). Ordem, e por quê:
--   1. trava a linha do workspace e reconfere a cobrança pelo espelho (allowlist: sem linha,
--      status nulo, `canceled` ou `incomplete_expired`; qualquer outro recusa com
--      `active_subscription`);
--   2. calcula os órfãos (sem outro workspace_members, fora de platform_admins);
--   3. reaponta profiles.active_workspace_id / conta_id de quem está nele para outro workspace
--      do qual participa (o FK de active_workspace_id é NO ACTION; conta_id é lido como o
--      workspace atual em vários lugares). Sem outro workspace, active_workspace_id fica NULL e
--      conta_id fica como está (sem FK) até o login sair;
--   4. revoga as conexões OAuth do MCP (o trigger trg_mcp_oauth_grant_revoked só dispara em
--      UPDATE de revoked_at, nunca em DELETE, e é ele que encerra o consentimento e as sessões
--      do lado do Supabase);
--   5. apaga workflow_posts primeiro: as guardas post_targets_guard_delete e
--      trg_post_comment_threads_geral_guard_delete só deixam passar quando o post já não existe,
--      e assim post_file_links sai antes de files (FK RESTRICT);
--   6. apaga workspace_members antes de workspace_roles (wm_role_same_workspace é RESTRICT);
--   7. DELETE real em workspaces com os triggers ligados (trg_workspaces_google_release solta as
--      identidades Google pela regra de sempre), que leva em cascata o que tem FK, mais um
--      DELETE por conta_id/workspace_id em cada tabela SEM FK para workspaces (clientes, membros,
--      workflows e ~45 outras em prod; admin_delete_workspace_loose_tables lê do catálogo), em
--      passadas com retry para a ordem entre elas. Sobrou algo = exceção e nada é apagado. As filas
--      file_deletions / post_media_deletions não têm FK, então o R2 e o Stream são limpos pelo
--      post-media-cleanup-cron como em qualquer exclusão de arquivo.
--   O audit_log da exclusão é gravado antes do DELETE; audit_log.conta_id é ON DELETE SET NULL,
--   então o id, o nome e o dono vão também em resource_id / metadata.

create or replace function public.admin_delete_workspace_billing_ok(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status is null or p_status in ('canceled', 'incomplete_expired');
$$;

revoke all on function public.admin_delete_workspace_billing_ok(text) from public, anon, authenticated;
grant execute on function public.admin_delete_workspace_billing_ok(text) to service_role;

-- Tabelas de public com coluna uuid `conta_id` ou `workspace_id` SEM FK para workspaces: a
-- cascata não as alcança (clientes, membros, workflows, leads, transacoes, contratos, invites e
-- mais umas 40 em prod, quase todas anteriores ao multi-workspace). Lida do catálogo a cada
-- chamada, então tabela nova nesse padrão entra sozinha. profiles fica de fora: lá conta_id é o
-- workspace aberto do usuário, nunca dado do workspace (o passo 3 cuida dele).
create or replace function public.admin_delete_workspace_loose_tables()
returns table (tbl text, col text)
language sql
stable
security definer
set search_path = public
as $$
  select format('%I.%I', n.nspname, c.relname), a.attname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and a.attname in ('conta_id', 'workspace_id')
     and a.atttypid = 'uuid'::regtype
     and c.relname not in ('workspaces', 'profiles')
     and not exists (
       select 1 from pg_constraint k
        where k.contype = 'f' and k.conrelid = c.oid
          and k.confrelid = 'public.workspaces'::regclass
          and a.attnum = any(k.conkey))
   order by c.relname;
$$;

revoke all on function public.admin_delete_workspace_loose_tables() from public, anon, authenticated;
grant execute on function public.admin_delete_workspace_loose_tables() to service_role;

create or replace function public.admin_delete_workspace_preview(p_conta uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws record;
  v_sub record;
  v_found_sub boolean := false;
begin
  select id, name, created_by into v_ws from public.workspaces where id = p_conta;
  if not found then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;

  select provider, status, stripe_subscription_id, pagarme_subscription_id
    into v_sub
    from public.workspace_subscriptions
   where workspace_id = p_conta;
  v_found_sub := found;

  return jsonb_build_object(
    'workspace', jsonb_build_object('id', v_ws.id, 'name', v_ws.name),
    'subscription', case when not v_found_sub then null else jsonb_build_object(
      'provider', v_sub.provider,
      'status', v_sub.status,
      'stripe_subscription_id', v_sub.stripe_subscription_id,
      'pagarme_subscription_id', v_sub.pagarme_subscription_id,
      'blocks', not public.admin_delete_workspace_billing_ok(v_sub.status)
    ) end,
    'counts', jsonb_build_object(
      'clientes', (select count(*) from public.clientes where conta_id = p_conta),
      'posts', (select count(*) from public.workflow_posts where conta_id = p_conta),
      'arquivos', (select count(*) from public.files where conta_id = p_conta),
      'membros', (select count(*) from public.workspace_members where workspace_id = p_conta)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', wm.user_id,
               'role', wm.role,
               'email', u.email,
               'name', coalesce(nullif(p.nome, ''), u.raw_user_meta_data->>'full_name'),
               'login_deleted',
                 not exists (select 1 from public.workspace_members o
                              where o.user_id = wm.user_id and o.workspace_id <> p_conta)
                 and not exists (select 1 from public.platform_admins pa where pa.user_id = wm.user_id)
             ) order by (wm.role = 'owner') desc, wm.joined_at)
        from public.workspace_members wm
        left join auth.users u on u.id = wm.user_id
        left join public.profiles p on p.id = wm.user_id
       where wm.workspace_id = p_conta
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_delete_workspace_preview(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_workspace_preview(uuid) to service_role;

create or replace function public.admin_delete_workspace(p_conta uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws record;
  v_status text;
  v_members uuid[];
  v_orphans uuid[];
  v_owner_email text;
  v_pending text[];
  v_next text[];
  v_item text;
  v_tbl text;
  v_col text;
  v_pass int;
  v_last_error text;
begin
  select id, name, created_by into v_ws from public.workspaces where id = p_conta for update;
  if not found then
    raise exception 'workspace_not_found' using errcode = 'P0002';
  end if;

  select status into v_status
    from public.workspace_subscriptions where workspace_id = p_conta for update;
  if found and not public.admin_delete_workspace_billing_ok(v_status) then
    raise exception 'active_subscription' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(user_id), '{}') into v_members
    from public.workspace_members where workspace_id = p_conta;

  select coalesce(array_agg(m), '{}') into v_orphans
    from unnest(v_members) m
   where not exists (select 1 from public.workspace_members o
                      where o.user_id = m and o.workspace_id <> p_conta)
     and not exists (select 1 from public.platform_admins pa where pa.user_id = m);

  select email into v_owner_email from auth.users where id = v_ws.created_by;

  insert into public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_conta, p_actor, 'admin-delete-workspace', 'workspace', p_conta::text, jsonb_build_object(
    'workspace_id', p_conta,
    'workspace_name', v_ws.name,
    'owner_user_id', v_ws.created_by,
    'owner_email', v_owner_email,
    'member_count', cardinality(v_members),
    'logins_to_delete', cardinality(v_orphans),
    'subscription_status', v_status
  ));

  -- 3. Quem está com este workspace aberto vai para outro do qual participa (o mais recente).
  update public.profiles p
     set active_workspace_id = case when p.active_workspace_id = p_conta then alt.ws
                                    else p.active_workspace_id end,
         -- conta_id não tem FK e é NOT NULL fora de prod: sem outro workspace, fica como está
         -- (o login de quem não tem outro workspace sai logo depois, exceto admin da plataforma).
         conta_id = case when p.conta_id = p_conta then coalesce(alt.ws, p.conta_id) else p.conta_id end
    from (
      select pr.id as user_id,
             (select o.workspace_id from public.workspace_members o
               where o.user_id = pr.id and o.workspace_id <> p_conta
               order by o.joined_at desc nulls last limit 1) as ws
        from public.profiles pr
       where pr.active_workspace_id = p_conta or pr.conta_id = p_conta
    ) alt
   where p.id = alt.user_id;

  -- 4. Encerra o lado do Supabase das conexões OAuth do MCP.
  update public.mcp_oauth_grants
     set revoked_at = now(), revoked_by = p_actor
   where conta_id = p_conta and revoked_at is null;

  -- 5 e 6. Filhos com guarda ou RESTRICT primeiro.
  delete from public.workflow_posts where conta_id = p_conta;
  delete from public.workspace_members where workspace_id = p_conta;

  -- 7. A linha de workspaces (cascata + triggers) e toda tabela com conta_id/workspace_id sem
  --    FK para workspaces (ver admin_delete_workspace_loose_tables). Passadas com retry: cada
  --    item roda num subtransação, e um item que falha por ordem (FK de outro item ainda vivo)
  --    tenta de novo na passada seguinte. Sobrou algo depois das passadas = erro, nada é apagado.
  v_pending := array['public.workspaces.id']
    || array(select format('%s.%s', t.tbl, t.col) from public.admin_delete_workspace_loose_tables() t);
  for v_pass in 1..8 loop
    exit when cardinality(v_pending) = 0;
    v_next := '{}';
    foreach v_item in array v_pending loop
      v_tbl := regexp_replace(v_item, '\.[^.]+$', '');
      v_col := regexp_replace(v_item, '^.*\.', '');
      begin
        execute format('delete from %s where %I = $1', v_tbl::regclass, v_col) using p_conta;
      exception when others then
        v_next := v_next || v_item;
        v_last_error := format('%s: %s', v_item, sqlerrm);
      end;
    end loop;
    v_pending := v_next;
  end loop;
  if cardinality(v_pending) > 0 then
    raise exception 'workspace_delete_incomplete' using
      errcode = 'P0001',
      detail = format('pendentes: %s; último erro: %s', array_to_string(v_pending, ', '), v_last_error);
  end if;

  return jsonb_build_object(
    'workspace_id', p_conta,
    'workspace_name', v_ws.name,
    'orphan_user_ids', to_jsonb(v_orphans)
  );
end;
$$;

revoke all on function public.admin_delete_workspace(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_workspace(uuid, uuid) to service_role;
