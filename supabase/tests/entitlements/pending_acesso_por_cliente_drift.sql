\set ON_ERROR_STOP on

-- Acesso por cliente, guarda de deriva (catálogo). PENDING: o nome sem dígito
-- inicial deixa o test:db pular este arquivo até a Task 4e renomeá-lo para
-- 99_acesso_por_cliente_drift.sql. Até lá ele FALHA de propósito, listando o
-- que as Tasks 3 e 4a-4e ainda têm de escopar.
--
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- "Tabela de cliente" é calculada no catálogo, não listada à mão:
--   raiz  = clientes, ou tabela com coluna cliente_id/client_id inteira
--           (client_id text é id de cliente OAuth, não de cliente do CRM);
--   filha = tabela com FK (em qualquer profundidade) para uma raiz.
-- Mais v_extra_scoped: ligações polimórficas sem FK que o catálogo não vê.
-- Uma tabela nova com cliente_id entra sozinha e quebra este arquivo até
-- ganhar o predicado ou uma entrada comentada em v_exempt.
--
-- Casos:
--   (Policies só de service_role, ou com USING (auth.role() = 'service_role'),
--   não contam; policy USING/WITH CHECK (false) não concede nada e passa;
--   RESTRICTIVE só estreita, então nunca é falha, só cobertura.)
--   every_client_table_scoped       a tabela tem RLS ligada e ao menos uma policy
--                                   de leitura, e toda policy PERMISSIVE (não
--                                   service_role) que expõe
--                                   linhas (SELECT/UPDATE/DELETE/ALL) cita
--                                   can_access_cliente ou can_see_cliente_context;
--                                   ou uma RESTRICTIVE do mesmo comando (ou ALL) cita; ou, só
--                                   para filha sem chave própria, o qual
--                                   consulta (FROM/JOIN) uma tabela-pai pela FK
--                                   que já passa (a RLS do pai vale dentro da
--                                   subconsulta).
--   every_client_table_write_checked toda policy INSERT/UPDATE/ALL (não
--                                   service_role) de tabela raiz tem WITH CHECK
--                                   explícito citando can_access_cliente ou
--                                   my_client_scope_all (sem WITH CHECK o
--                                   Postgres usa o USING, que traz o "é dele",
--                                   e a escrita ficaria com a exceção que a spec
--                                   proíbe). Filha passa também consultando um
--                                   pai que passa.
--   every_client_view_filtered      view sobre tabela de cliente é
--                                   security_invoker=true ou cita o predicado.
--   context_fn_covers_own_tables    toda tabela "raiz de contexto" (v_context_roots,
--                                   mais qualquer tabela de cliente cuja policy
--                                   use my_membro_ids()) aparece no corpo de
--                                   can_see_cliente_context(bigint).
-- Sanidade: todo nome dos arrays existe; toda entrada de v_exempt_no_policy
-- continua com RLS ligada e sem policy fora de service_role.

begin;

do $$
declare
  -- Ligações sem FK (polimórficas ou sem FK de propósito) que o catálogo não
  -- acha sozinho. Ver o inventário, seção "Ligações sem FK".
  v_extra_scoped text[] := array[
    'folders',  -- source_type/source_id: client | workflow | post | client_reports
    'files',    -- cliente via folders.folder_id (FK para folders, que é polimórfica)
    'mencoes'   -- host_type/host_id: post_comment | tarefa | workflow_post | tarefa_comentario
  ];

  -- Tabelas de cliente sem policy para authenticated/anon/public, com RLS
  -- ligada: só service_role lê. Isentas enquanto continuarem assim; o caso de
  -- sanidade falha se alguém criar uma policy, para forçar a triagem.
  v_exempt_no_policy text[] := array[
    -- agenda: escrita e leitura só pelas RPCs SECURITY DEFINER e edges (Task 5 / 4d)
    'agenda_convidados', 'agenda_emails_cliente', 'agenda_lembretes',
    'agenda_remarcacoes', 'agenda_respostas_cliente', 'agenda_respostas_convidado',
    -- Google: lido só por gbp-analytics / youtube-analytics (service role, Task 13)
    'gbp_locations', 'gbp_metrics_daily', 'gbp_rating_daily', 'gbp_reviews',
    'gbp_search_keywords_monthly',
    'youtube_channels', 'youtube_channel_daily', 'youtube_demographics',
    'youtube_traffic_daily', 'youtube_video_daily', 'youtube_videos',
    'youtube_pdf_purges',                 -- fila do youtube-sync-cron
    'mensagens_last_seen',                -- só hub-mensagens / client-event-email-cron
    'tiktok_post_metrics_daily',          -- só tiktok-sync-cron / tiktok-analytics (Task 13)
    -- policy única "Service role full access" TO public USING (auth.role() = 'service_role'):
    -- authenticated não lê; só os syncs/analytics do Instagram e TikTok (Task 13)
    'instagram_account_metrics_daily', 'instagram_account_metrics_monthly',
    'instagram_story_insights', 'tiktok_account_metrics_daily'
  ];

  -- Outras isenções, cada uma com o motivo.
  v_exempt text[] := array[
    'workspace_member_clientes',   -- a própria tabela de atribuições (Task 1, policy própria)
    'financeiro_atribuicoes',      -- Task 6: escrita só por RPC, filtro na camada de leitura
    'financeiro_cliente_versoes',  -- Task 6
    'financeiro_entregas_manuais', -- Task 6
    'oauth_states'                 -- RLS desligada (estado de OAuth, só service role usa);
                                   -- ver "Surpresas" no relatório da Task 2
  ];

  -- Itens que um restrito pode ter "dele" num cliente oculto e que precisam do
  -- contexto do cliente (nome, marca). Task 1 cobre os três primeiros; ideias
  -- vem da spec (ideias.autor_membro_id). Toda tabela cuja policy passe a usar
  -- my_membro_ids() entra sozinha (ver o caso).
  v_context_roots text[] := array['workflow_posts', 'workflow_etapas', 'tarefas', 'ideias'];

  v_read_pred  text := '\m(can_access_cliente|can_see_cliente_context)\M';
  v_write_pred text := '\m(can_access_cliente|my_client_scope_all)\M';

  v_missing text[];
  v_fail_read text[] := '{}';
  v_fail_write text[] := '{}';
  v_fail_view text[] := '{}';
  v_fail_ctx text[] := '{}';
  v_fail_np text[] := '{}';
  v_changed bigint;
  v_ctx_src text;
begin
  -- sanity: every hardcoded name exists
  select array_agg(n) into v_missing
    from unnest(v_extra_scoped || v_exempt_no_policy || v_exempt || v_context_roots) n
   where to_regclass('public.' || n) is null;
  assert v_missing is null, 'sanity: unknown tables in the arrays: ' || array_to_string(v_missing, ', ');

  -- client tables: roots, FK closure, extras
  create temp table _ct on commit drop as
  with recursive base as (
    select c.oid, true as is_root
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and (c.relname = 'clientes'
            or exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                          and a.attname in ('cliente_id', 'client_id')
                          and a.atttypid in ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)))
    union
    select k.conrelid, false
      from pg_constraint k join base b on k.confrelid = b.oid
     where k.contype = 'f' and k.conrelid <> k.confrelid
  )
  select oid, oid::regclass::text as tbl, bool_or(is_root) as is_root from base group by oid;

  insert into _ct
  select ('public.' || n)::regclass::oid, n,
         n in ('folders', 'mencoes')   -- polimórficas: sem pai por FK, contam como raiz
    from unnest(v_extra_scoped) n
   where not exists (select 1 from _ct where tbl = n);

  -- scoped = client tables minus exemptions
  create temp table _scoped on commit drop as
  select * from _ct where tbl <> all (v_exempt || v_exempt_no_policy);

  -- policies that only ever match service_role (BYPASSRLS anyway): TO service_role,
  -- or the legacy USING (auth.role() = 'service_role') with no other check
  create temp table _svc_pol on commit drop as
  select p.tablename::text as tbl, p.policyname::text as policyname
    from pg_policies p
   where p.schemaname = 'public'
     and (p.roles = array['service_role']::name[]
          or (coalesce(p.qual, '') ~ '^\(auth\.role\(\) = ''service_role''::text\)$'
              and coalesce(p.with_check, p.qual) = p.qual));

  -- applicable policies
  create temp table _pol on commit drop as
  select s.tbl, s.is_root, p.policyname, p.permissive, p.cmd,
         coalesce(p.qual, '') as qual, coalesce(p.with_check, '') as wc
    from _scoped s
    join pg_policies p on p.schemaname = 'public' and p.tablename = s.tbl
   where (p.tablename::text, p.policyname::text) not in (select tbl, policyname from _svc_pol);

  -- FK parents of each client table that are client tables themselves
  create temp table _parent on commit drop as
  select distinct k.conrelid::regclass::text as tbl, k.confrelid::regclass::text as parent
    from pg_constraint k
   where k.contype = 'f' and k.conrelid <> k.confrelid
     and k.conrelid in (select oid from _ct) and k.confrelid in (select oid from _ct);

  -- ---------------------------------------------------------------------------
  -- every_client_table_scoped (fixpoint: a child passes once its parent passes)
  create temp table _read_ok (tbl text primary key) on commit drop;
  loop
    insert into _read_ok
    select s.tbl from _scoped s
     where s.tbl not in (select tbl from _read_ok)
       and (select c.relrowsecurity from pg_class c where c.oid = s.oid)
       and exists (select 1 from _pol p where p.tbl = s.tbl and p.cmd in ('SELECT', 'ALL'))
       and not exists (
           select 1 from _pol p
            where p.tbl = s.tbl and p.permissive = 'PERMISSIVE'
              and p.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
              and not (
                p.qual ~ v_read_pred
                or p.qual = 'false'   -- policy que não concede nada
                -- uma RESTRICTIVE do mesmo comando (ou ALL) com o predicado cobre esta
                or exists (select 1 from _pol q where q.tbl = s.tbl and q.permissive = 'RESTRICTIVE'
                              and q.cmd in (p.cmd, 'ALL') and q.qual ~ v_read_pred)
                or (not s.is_root and exists (
                      select 1 from _parent pa join _read_ok ok on ok.tbl = pa.parent
                       where pa.tbl = s.tbl
                         and p.qual ~* ('\m(from|join)\s+\(*\s*(public\.)?' || pa.parent || '\M')))));
    get diagnostics v_changed = row_count;
    exit when v_changed = 0;
  end loop;

  select coalesce(array_agg(tbl order by tbl), '{}') into v_fail_read
    from _scoped where tbl not in (select tbl from _read_ok);

  -- ---------------------------------------------------------------------------
  -- every_client_table_write_checked
  select coalesce(array_agg(distinct p.tbl || '.' || p.policyname order by p.tbl || '.' || p.policyname), '{}')
    into v_fail_write
    from _pol p
   where p.cmd in ('INSERT', 'UPDATE', 'ALL')
     and not (
       p.wc ~ v_write_pred
       or coalesce(nullif(p.wc, ''), p.qual) = 'false'   -- não concede escrita
       or p.permissive = 'RESTRICTIVE'   -- restrictive só estreita, nunca concede
       or (not p.is_root and exists (
             select 1 from _parent pa join _read_ok ok on ok.tbl = pa.parent
              where pa.tbl = p.tbl
                and coalesce(nullif(p.wc, ''), p.qual) ~* ('\m(from|join)\s+\(*\s*(public\.)?' || pa.parent || '\M'))))
     -- a RESTRICTIVE policy de escrita com o predicado cobre a tabela toda
     and not exists (
       select 1 from _pol q where q.tbl = p.tbl and q.permissive = 'RESTRICTIVE'
          and q.cmd in (p.cmd, 'ALL') and q.wc ~ v_write_pred);

  -- ---------------------------------------------------------------------------
  -- every_client_view_filtered
  select coalesce(array_agg(v.relname::text order by v.relname), '{}') into v_fail_view
    from pg_class v
   where v.relnamespace = 'public'::regnamespace and v.relkind in ('v', 'm')
     and exists (select 1 from pg_rewrite rw join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
                  where rw.ev_class = v.oid and d.refobjid in (select oid from _scoped))
     and not (coalesce(v.reloptions, '{}') && array['security_invoker=true', 'security_invoker=on'])
     and pg_get_viewdef(v.oid) !~ v_read_pred;

  -- ---------------------------------------------------------------------------
  -- context_fn_covers_own_tables
  v_ctx_src := pg_get_functiondef('public.can_see_cliente_context(bigint)'::regprocedure);
  select coalesce(array_agg(t order by t), '{}') into v_fail_ctx
    from (select unnest(v_context_roots) t
          union
          select distinct tbl from _pol where qual ~ '\mmy_membro_ids\M') x
   where v_ctx_src !~ ('\m' || t || '\M');

  -- sanity: no-policy exemptions are still policy-less
  select coalesce(array_agg(n order by n), '{}') into v_fail_np
    from unnest(v_exempt_no_policy) n
   where not (select relrowsecurity from pg_class where oid = ('public.' || n)::regclass)
      or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = n
                   and (p.tablename::text, p.policyname::text) not in (select tbl, policyname from _svc_pol));

  raise notice 'client tables: % (scoped %, exempt %)',
    (select count(*) from _ct), (select count(*) from _scoped), (select count(*) from _ct) - (select count(*) from _scoped);
  if cardinality(v_fail_read) > 0 then
    raise notice 'every_client_table_scoped: % unscoped: %', cardinality(v_fail_read), array_to_string(v_fail_read, ', ');
  end if;
  if cardinality(v_fail_write) > 0 then
    raise notice 'every_client_table_write_checked: % policies: %', cardinality(v_fail_write), array_to_string(v_fail_write, ', ');
  end if;
  if cardinality(v_fail_view) > 0 then
    raise notice 'every_client_view_filtered: %', array_to_string(v_fail_view, ', ');
  end if;
  if cardinality(v_fail_ctx) > 0 then
    raise notice 'context_fn_covers_own_tables: missing %', array_to_string(v_fail_ctx, ', ');
  end if;

  assert cardinality(v_fail_np) = 0,
    'exempt_no_policy_still_policyless: ' || array_to_string(v_fail_np, ', ');
  assert cardinality(v_fail_read) = 0,
    'every_client_table_scoped: ' || array_to_string(v_fail_read, ', ');
  assert cardinality(v_fail_write) = 0,
    'every_client_table_write_checked: ' || array_to_string(v_fail_write, ', ');
  assert cardinality(v_fail_view) = 0,
    'every_client_view_filtered: ' || array_to_string(v_fail_view, ', ');
  assert cardinality(v_fail_ctx) = 0,
    'context_fn_covers_own_tables: ' || array_to_string(v_fail_ctx, ', ');

  raise notice 'PASS 99_acesso_por_cliente_drift';
end $$;
rollback;
