-- Data import wizard: job bookkeeping + atomic per-source-row commit.
-- Spec: docs/superpowers/specs/2026-07-27-data-import-migration-design.md

create table if not exists public.import_jobs (
  id bigint generated always as identity primary key,
  conta_id uuid not null,
  created_by uuid,
  source text not null,
  status text not null default 'committing'
    check (status in ('committing', 'completed', 'undone')),
  total_rows integer,
  created_at timestamptz not null default now()
);

create table if not exists public.import_job_items (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.import_jobs (id) on delete cascade,
  conta_id uuid not null,
  table_name text not null,
  -- text: created ids are mixed types (clientes/workflows/workflow_posts bigint, ideias uuid)
  row_id text not null,
  source_row_key text not null,
  ordinal integer not null default 0,
  -- true = this row records a PRE-EXISTING cliente that the import merged into,
  -- not a row the import created. Reference resolution and the resume probe must
  -- still find it (a merged cliente is a valid clienteRef target, and a
  -- re-committed merge must still be skipped), but UNDO MUST NEVER DELETE IT --
  -- deleting it would destroy a client the customer already owned, cascading into
  -- their workflows, etapas, posts, ideias, instagram_accounts and folders.
  -- Every undo delete must therefore filter `where not merged`.
  merged boolean not null default false,
  -- Where this row came from (source tool, collection, original item URL,
  -- raw cells, any attachment URLs). The design promises source traceability
  -- for every imported row; it lives HERE rather than as a new jsonb column on
  -- clientes/workflows/workflow_posts/ideias, so the hot domain tables stay
  -- unchanged and provenance is deleted automatically when a job is undone.
  provenance jsonb,
  created_at timestamptz not null default now(),
  -- job_id lookups ride this index's leading column, so no separate (job_id) index.
  unique (job_id, source_row_key, table_name, ordinal)
);

alter table public.import_jobs enable row level security;
alter table public.import_job_items enable row level security;

-- Workspace members may read their own jobs (wizard history / undo button state).
-- Writes happen only through the service-role edge function.
-- drop-then-create (Postgres has no `create policy if not exists`) so a partially
-- applied file can be re-run -- matches 20260720000002_kb_images_bucket.sql:22.
drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select on public.import_jobs
  for select using (conta_id = public.get_my_conta_id());
drop policy if exists import_job_items_select on public.import_job_items;
create policy import_job_items_select on public.import_job_items
  for select using (conta_id = public.get_my_conta_id());

-- Atomic commit of ONE source row: inserts target row(s) + bookkeeping items in
-- a single transaction. Resume-idempotent: if the PRIMARY item for
-- (job, source_row_key) already exists, returns it with skipped=true.
create or replace function public.import_commit_row(
  p_conta_id uuid,
  p_job_id bigint,
  p_source_row_key text,
  p_kind text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.import_jobs%rowtype;
  v_existing public.import_job_items%rowtype;
  v_primary_table text;
  v_id text;
  v_cliente_id bigint;
  v_workflow_id bigint;
  v_template_id bigint;
  v_etapa text;
  v_etapa_id text;
  v_status text;
  v_tipo text;
  v_i integer;
  v_user_id uuid;
begin
  select * into v_job from public.import_jobs where id = p_job_id and conta_id = p_conta_id;
  -- 'completed' stays writable: a retry after a failed FINAL batch re-runs from
  -- batch 0 against a job already marked completed; idempotency makes it a no-op.
  if not found or v_job.status = 'undone' then
    raise exception 'import job not found or undone';
  end if;
  v_user_id := v_job.created_by;

  v_primary_table := case p_kind
    when 'cliente' then 'clientes'
    when 'container' then 'workflows'
    when 'template' then 'workflow_templates'
    when 'entrega' then 'workflows'
    when 'post' then 'workflow_posts'
    when 'ideia' then 'ideias'
    else null end;
  if v_primary_table is null then
    raise exception 'unknown import kind %', p_kind;
  end if;

  -- Idempotency: primary row only (ordinal 0).
  select * into v_existing from public.import_job_items
    where job_id = p_job_id and source_row_key = p_source_row_key
      and table_name = v_primary_table and ordinal = 0;
  if found then
    return jsonb_build_object('skipped', true, 'table', v_primary_table, 'row_id', v_existing.row_id);
  end if;

  if p_kind = 'cliente' then
    if p_payload ? 'mergeClienteId' then
      -- fill-only-empty-fields merge into a cliente the workspace already owns.
      -- A bookkeeping row IS recorded (later rows resolve clienteRef{created} through
      -- it), but flagged merged=true so undo can never delete the pre-existing cliente.
      update public.clientes set
        email = coalesce(nullif(email, ''), p_payload->>'email', email),
        telefone = coalesce(nullif(telefone, ''), p_payload->>'telefone', telefone),
        especialidade = coalesce(nullif(especialidade, ''), p_payload->>'especialidade', especialidade),
        notion_page_url = coalesce(nullif(notion_page_url, ''), p_payload->>'notionPageUrl', notion_page_url)
      where id = (p_payload->>'mergeClienteId')::bigint and conta_id = p_conta_id;
      -- TENANT GATE: mergeClienteId is client-supplied and clientes.id is a sequential
      -- bigint. Without this check a zero-row UPDATE would pass silently and the
      -- bookkeeping row below would map source_row_key -> another workspace's cliente,
      -- which import_resolve_cliente would then hand to workflows/ideias inserts.
      -- Also turns a nonexistent id into a clear error instead of a downstream FK failure.
      if not found then
        raise exception 'cliente % does not belong to this workspace',
          (p_payload->>'mergeClienteId')::bigint;
      end if;
      -- record the mapping so later rows can resolve clienteRef{created:sourceKey}
      insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key,
                                           ordinal, merged)
        values (p_job_id, p_conta_id, 'clientes', p_payload->>'mergeClienteId', p_source_row_key,
                0, true);
      return jsonb_build_object('skipped', false, 'table', 'clientes', 'row_id', p_payload->>'mergeClienteId');
    end if;
    insert into public.clientes (conta_id, user_id, nome, sigla, cor, plano, email, telefone,
                                 status, valor_mensal, especialidade, notion_page_url)
    values (p_conta_id, v_user_id, p_payload->>'nome',
            upper(left(regexp_replace(p_payload->>'nome', '[^a-zA-Z]', '', 'g') || 'XX', 2)),
            coalesce(p_payload->>'cor', '#eab308'), '',
            coalesce(p_payload->>'email', ''), coalesce(p_payload->>'telefone', ''),
            'ativo', coalesce((p_payload->>'valorMensal')::numeric, 0),
            p_payload->>'especialidade', p_payload->>'notionPageUrl')
    returning id::text into v_id;

  elsif p_kind = 'template' then
    insert into public.workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (p_conta_id, v_user_id, p_payload->>'nome',
      -- coalesce to '[]': jsonb_agg over an empty set returns NULL, and
      -- jsonb_array_elements_text is STRICT so a missing/empty 'etapas' yields no rows.
      -- Naming `etapas` in the column list defeats the table DEFAULT '[]'
      -- (20260301_baseline_schema.sql:139), so the row would land with etapas IS NULL --
      -- and the Entregas wizard is not null-safe: StepTemplate.tsx:131 reads
      -- `t.etapas.length` for EVERY template in the picker, so one NULL row throws
      -- while rendering the list and breaks the wizard workspace-wide.
      coalesce((select jsonb_agg(jsonb_build_object(
         'nome', e.value, 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'padrao'))
       from jsonb_array_elements_text(p_payload->'etapas') e), '[]'::jsonb),
      'padrao')
    returning id::text into v_id;

  elsif p_kind = 'container' then
    v_cliente_id := public.import_resolve_cliente(p_conta_id, p_job_id, p_payload);
    insert into public.workflows (conta_id, user_id, cliente_id, titulo, status,
                                  etapa_atual, recorrente, created_via)
    -- created_via 'human', NOT 'agent': the enum is only ('human','agent') and the
    -- UI renders 'agent' as a "Criado por agente de IA" badge
    -- (apps/crm/src/pages/entregas/components/WorkflowCard.tsx:276). Imported rows
    -- were authored by a person in another tool, and their real origin is recorded
    -- in import_job_items.provenance.
    values (p_conta_id, v_user_id, v_cliente_id, p_payload->>'titulo', 'ativo', 0, false, 'human')
    returning id::text into v_id;

  elsif p_kind = 'entrega' then
    v_cliente_id := public.import_resolve_cliente(p_conta_id, p_job_id, p_payload);
    select row_id::bigint into v_template_id from public.import_job_items
      where job_id = p_job_id and source_row_key = p_payload->>'templateKey'
        and table_name = 'workflow_templates' and ordinal = 0;
    if v_template_id is null then raise exception 'template % not committed yet', p_payload->>'templateKey'; end if;
    insert into public.workflows (conta_id, user_id, cliente_id, titulo, template_id, status,
                                  etapa_atual, recorrente, modo_prazo, created_via)
    values (p_conta_id, v_user_id, v_cliente_id, p_payload->>'titulo', v_template_id, 'ativo',
            coalesce((p_payload->>'etapaIndex')::int, 0), false, 'padrao', 'human')
    returning id::text into v_id;
    -- etapas come from the TEMPLATE row (single source of truth — the wire
    -- CommitEntregaRow carries only templateKey + etapaIndex, never etapa names).
    -- prior=concluido, current=ativo, later=pendente.
    v_i := 0;
    for v_etapa in
      select e->>'nome' from public.workflow_templates t,
             jsonb_array_elements(t.etapas) e where t.id = v_template_id
    loop
      insert into public.workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status,
                                          data_limite)
      values (v_id::bigint, v_i, v_etapa, 1, 'uteis', 'padrao',
              case when v_i < coalesce((p_payload->>'etapaIndex')::int, 0) then 'concluido'
                   when v_i = coalesce((p_payload->>'etapaIndex')::int, 0) then 'ativo'
                   else 'pendente' end,
              -- data_limite is `date` (supabase/migrations/20260421000000_workflow_deadline_modes.sql:9),
              -- not timestamptz: cast straight to date so no session-timezone truncation can shift the
              -- calendar day the wizard/user actually picked.
              case when v_i = coalesce((p_payload->>'etapaIndex')::int, 0)
                   then (p_payload->>'dueDate')::date else null end)
      returning id::text into v_etapa_id;
      insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key, ordinal)
        values (p_job_id, p_conta_id, 'workflow_etapas', v_etapa_id, p_source_row_key, v_i + 1);
      v_i := v_i + 1;
    end loop;

  elsif p_kind = 'post' then
    select row_id::bigint into v_workflow_id from public.import_job_items
      where job_id = p_job_id and source_row_key = p_payload->>'containerKey'
        and table_name = 'workflows' and ordinal = 0;
    if v_workflow_id is null then raise exception 'container % not committed yet', p_payload->>'containerKey'; end if;
    -- SERVER-SIDE STATUS CLAMP (defense in depth — do not rely on the browser).
    -- The mapper's clamp lives in client code, but /data-import/commit accepts
    -- arbitrary JSON from any authenticated member, so an 'agendado' row posted
    -- directly (or produced by a buildCommitRows bug) would be picked up by
    -- instagram-publish-cron / tiktok-publish-cron with no media attached.
    -- 'agendado' and 'falha_publicacao' are never importable; 'postado' requires
    -- a past date. Anything unrecognized degrades to 'rascunho'.
    v_status := coalesce(p_payload->>'status', 'rascunho');
    if v_status not in ('rascunho', 'revisao_interna', 'aprovado_interno',
                        'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'postado') then
      v_status := 'rascunho';
    end if;
    if v_status = 'postado'
       and coalesce((p_payload->>'publishedAt')::timestamptz,
                    (p_payload->>'scheduledAt')::timestamptz, now()) > now() then
      v_status := 'aprovado_cliente';
    end if;
    -- SERVER-SIDE TIPO CLAMP, same reasoning as the status clamp above: `tipo` is
    -- CHECK-constrained to ('feed','reels','stories','carrossel')
    -- (20260402_workflow_posts.sql:19-20) and arrives in the same untrusted JSON blob.
    -- A CSV carrying 'Carrossel' / 'video' / 'Vídeo' would otherwise raise a
    -- constraint violation and lose the row. Unrecognized degrades to 'feed'.
    v_tipo := coalesce(p_payload->>'tipo', 'feed');
    if v_tipo not in ('feed', 'reels', 'stories', 'carrossel') then
      v_tipo := 'feed';
    end if;
    insert into public.workflow_posts (workflow_id, conta_id, titulo, conteudo, conteudo_plain, tipo,
                                       ordem, status, scheduled_at, published_at, created_via)
    -- titulo is `text not null default ''` (20260402_workflow_posts.sql:16), but naming
    -- it in the column list defeats the default -- an absent/JSON-null titulo would
    -- raise a NOT NULL violation and lose the row. A blank title is routine in a
    -- content-calendar CSV where the caption carries the content.
    values (v_workflow_id, p_conta_id, coalesce(p_payload->>'titulo', ''),
            p_payload->'conteudo', coalesce(p_payload->>'conteudoPlain', ''),
            v_tipo,
            -- ordem: next free slot in this container, derived from the posts already
            -- inserted for this workflow rather than carried on the wire. Keeps a stable
            -- order within a container and stays correct across a resumed/retried batch
            -- (already-committed posts are counted, so the sequence continues).
            (select coalesce(max(wp.ordem) + 1, 0) from public.workflow_posts wp
              where wp.workflow_id = v_workflow_id),
            v_status,
            (p_payload->>'scheduledAt')::timestamptz, (p_payload->>'publishedAt')::timestamptz, 'human')
    returning id::text into v_id;

  elsif p_kind = 'ideia' then
    v_cliente_id := public.import_resolve_cliente(p_conta_id, p_job_id, p_payload);
    -- links deliberately omitted: ideias.links is text[] not null default '{}'
    -- (supabase/migrations/20260414114009_ideias.sql:8), so the column default applies.
    insert into public.ideias (workspace_id, cliente_id, titulo, descricao, status)
    values (p_conta_id, v_cliente_id, p_payload->>'titulo',
            coalesce(p_payload->>'descricao', ''), 'nova')
    returning id::text into v_id;
  end if;

  insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key,
                                       ordinal, provenance)
    values (p_job_id, p_conta_id, v_primary_table, v_id, p_source_row_key, 0,
            p_payload->'provenance');
  return jsonb_build_object('skipped', false, 'table', v_primary_table, 'row_id', v_id);
end;
$$;

-- Resolves a payload's clienteRef: {"clienteRef":{"type":"existing","clienteId":N}}
-- or {"clienteRef":{"type":"created","sourceKey":"..."}} via import_job_items.
--
-- SECURITY: clienteRef is fully client-supplied and clientes.id is a sequential
-- bigint, so the 'existing' branch MUST verify tenant ownership. Without it, a
-- user of workspace A could attach workflows/ideias to workspace B's cliente_id
-- (this function is SECURITY DEFINER, so RLS does not save us). Both branches are
-- conta-scoped below.
create or replace function public.import_resolve_cliente(
  p_conta_id uuid, p_job_id bigint, p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_payload->'clienteRef'->>'type' = 'existing' then
    v_id := (p_payload->'clienteRef'->>'clienteId')::bigint;
    if not exists (select 1 from public.clientes where id = v_id and conta_id = p_conta_id) then
      raise exception 'cliente % does not belong to this workspace', v_id;
    end if;
    return v_id;
  end if;
  -- 'created' branch: note `conta_id = p_conta_id` proves only that the BOOKKEEPING
  -- row belongs to the caller -- never that the cliente id inside row_id does. The
  -- writers above keep that invariant (both the insert and the merge path are
  -- conta-scoped and the merge now raises on a zero-row UPDATE), but re-assert it
  -- here so the guarantee is local to this function and cannot be broken by a future
  -- writer of import_job_items.
  select row_id::bigint into v_id from public.import_job_items
    where job_id = p_job_id and conta_id = p_conta_id
      and source_row_key = p_payload->'clienteRef'->>'sourceKey'
      and table_name = 'clientes' and ordinal = 0;
  if v_id is null then
    raise exception 'cliente % not committed yet', p_payload->'clienteRef'->>'sourceKey';
  end if;
  if not exists (select 1 from public.clientes where id = v_id and conta_id = p_conta_id) then
    raise exception 'cliente % does not belong to this workspace', v_id;
  end if;
  return v_id;
end;
$$;

-- CRITICAL (repo gotcha): REVOKE FROM PUBLIC also strips service_role.
-- The explicit grants below are what let the edge function call these at all.
revoke all on function public.import_commit_row(uuid, bigint, text, text, jsonb) from public;
grant execute on function public.import_commit_row(uuid, bigint, text, text, jsonb) to service_role;
revoke all on function public.import_resolve_cliente(uuid, bigint, jsonb) from public;
grant execute on function public.import_resolve_cliente(uuid, bigint, jsonb) to service_role;
