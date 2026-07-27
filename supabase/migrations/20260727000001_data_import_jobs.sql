-- Data import wizard: job bookkeeping + atomic per-source-row commit.
-- Spec: docs/superpowers/specs/2026-07-27-data-import-migration-design.md
--
-- OPERATOR SMOKE TESTS -- run these in the SQL editor (inside begin; … rollback;)
-- after applying, BEFORE this ships. The Deno edge-function suite mocks the RPC,
-- so none of the behaviour below is covered by an executable test anywhere else.
--   1. Tenant guard: import_commit_row with a clienteRef naming a cliente from
--      another conta_id must raise `cliente % does not belong to this workspace`.
--   2. Idempotency: a second call with the same (job_id, source_row_key) returns
--      skipped=true and the SAME row_id.
--   3. Status clamp: a post row with "status":"agendado" lands as 'rascunho';
--      one with "status":"postado" and a FUTURE date lands as 'aprovado_cliente'.
--   4. published_at invariant (added 2026-07-27): the SAME future-dated 'postado'
--      row from (3) must land with published_at IS NULL and scheduled_at holding
--      that future date. A past-dated 'postado' row must land with published_at
--      set. Assert it directly:
--        select count(*) from workflow_posts
--         where published_at is not null and status <> 'postado';  -- must be 0
--   5. Undo lockout: set import_jobs.status='undoing', then call
--      import_commit_row for that job -- it must raise, not insert.
--   6. Lock (round 7, 2026-07-27): from two separate sessions, race a commit
--      and an undo on the SAME job_id. Session A: begin; select import_commit_row(...)
--      -- do not commit yet. Session B (concurrently): begin;
--      update import_jobs set status='undoing' where id=<job> -- this must BLOCK
--      until session A commits or rolls back. Commit session A, then let
--      session B's update proceed and finish the undo. Assert: the row session
--      A inserted is gone (undo's delete saw it and removed it), never orphaned
--      -- i.e. no import_job_items row survives referencing a table row that
--      import_jobs.status='undone' claims was fully undone.
--   7. Missing nome (round 7, 2026-07-27): call import_commit_row with
--      p_kind='cliente' and a payload whose "nome" key is JSON null (and,
--      separately, a payload where "nome" is entirely absent) -- both must
--      raise `import row % has no usable nome (cliente name)`, never a bare
--      `null value in column "nome"` / "sigla" constraint violation.

create table if not exists public.import_jobs (
  id bigint generated always as identity primary key,
  conta_id uuid not null,
  created_by uuid not null,
  source text not null,
  -- 'undoing' is the in-flight undo state and it is LOAD-BEARING, not cosmetic.
  -- Undo pages through import_job_items, deletes, and only then marks the job.
  -- Without a state set BEFORE that read, a commit batch running concurrently
  -- inserts rows the undo never saw; the job then lands 'undone' and a retried
  -- undo short-circuits on "Already undone", orphaning those rows forever.
  -- import_commit_row refuses to write to an 'undoing' job (see below), which is
  -- what actually closes the window for a commit already inside its RPC loop.
  status text not null default 'committing'
    check (status in ('committing', 'completed', 'undoing', 'undone')),
  total_rows integer,
  -- When the current/last undo attempt claimed the job. An edge-function kill
  -- mid-undo leaves status='undoing' forever; the handler treats an 'undoing'
  -- job whose claim is older than its stale window as resumable (the deletes are
  -- id-based and idempotent), so a stuck job self-heals without operator SQL.
  undo_started_at timestamptz,
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

-- IDEMPOTENCY (added round 3, 2026-07-27): `undo_started_at` and the widened
-- status check above were edited straight into this `create table if not
-- exists` block. If any environment already applied the pre-round-3 version
-- of this file, the create is a no-op there and its migration version is
-- already recorded in schema_migrations, so it never replays -- these two
-- statements would then never land. The failure is silent and misleading:
-- handleUndo's probe selects undo_started_at, PostgREST rejects the unknown
-- column, `.single()` returns null, and undo answers 404 "Job not found" for
-- every job, while the handler's own `update({status:'undoing'})` would also
-- violate the old, narrower check. `add column if not exists` / drop-then-add
-- the constraint converge the file to the intended shape whether or not the
-- pre-round-3 version ever ran, while the column staying in the `create table`
-- above keeps a fresh apply producing the right shape in one step.
alter table public.import_jobs add column if not exists undo_started_at timestamptz;

alter table public.import_jobs drop constraint if exists import_jobs_status_check;
alter table public.import_jobs add constraint import_jobs_status_check
  check (status in ('committing', 'completed', 'undoing', 'undone'));

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
  v_source_at timestamptz;
  v_scheduled_at timestamptz;
  v_published_at timestamptz;
  v_i integer;
  v_user_id uuid;
begin
  -- `for update`: this row lock is what actually closes the undo/commit race,
  -- not the status check below on its own (that check only decides what THIS
  -- call does once it already holds the lock). A concurrent undo's
  -- `update import_jobs set status = 'undoing' ...` needs the SAME row lock,
  -- so it blocks until this transaction commits or rolls back:
  --   * if this call acquires the lock first, it runs its full insert(s) +
  --     bookkeeping and COMMITS before undo's status flip can proceed -- so by
  --     the time undo re-reads import_job_items (which it only does after its
  --     own status update has committed), this call's row already exists and
  --     is in undo's delete list. No orphan.
  --   * if undo's status flip acquires the lock first (and commits 'undoing'
  --     before this call's `for update` returns), this call then reads
  --     v_job.status = 'undoing' and is refused by the check below -- it
  --     never inserts anything.
  -- Either ordering is safe. What the lock rules out is the interleaving this
  -- function used to allow: this call's status read and its insert straddling
  -- undo's read of import_job_items, with neither transaction blocking the
  -- other -- which is exactly how a committed row could end up invisible to
  -- an undo that had already started (and finished) deleting.
  --
  -- Side effect: two commit calls for the SAME job now serialize on this lock
  -- (the second's `for update` blocks until the first's transaction ends).
  -- That is acceptable -- the edge function drives batches for one job
  -- sequentially, never concurrently, so this lock is never on the hot path;
  -- it only ever matters against a concurrent undo.
  select * into v_job from public.import_jobs where id = p_job_id and conta_id = p_conta_id
    for update;
  -- 'completed' stays writable: a retry after a failed FINAL batch re-runs from
  -- batch 0 against a job already marked completed; idempotency makes it a no-op.
  --
  -- 'undoing' is refused for the same reason as 'undone' -- this is what this
  -- call does with the lock it now holds, per the comment above.
  if not found or v_job.status in ('undoing', 'undone') then
    raise exception 'import job not found or being undone';
  end if;
  v_user_id := v_job.created_by;
  -- Belt and braces: created_by is NOT NULL on new rows, but this guards any row
  -- that predates the constraint or arrives through another path -- without it,
  -- a NULL here surfaces three inserts later as an opaque
  -- `null value in column "user_id"` with no hint that the job row is the cause.
  if v_user_id is null then
    raise exception 'import job % has no created_by user', p_job_id;
  end if;

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
      where id = (p_payload->>'mergeClienteId')::bigint and conta_id = p_conta_id
      -- Canonicalize row_id to Postgres's own rendering of the bigint (rather than
      -- the raw client-supplied text) so a payload like " 42 " or "042" can't leave
      -- row_id holding a string a future text comparison would fail to match.
      returning id::text into v_id;
      -- TENANT GATE: mergeClienteId is client-supplied and clientes.id is a sequential
      -- bigint. Without this check a zero-row UPDATE would pass silently and the
      -- bookkeeping row below would map source_row_key -> another workspace's cliente,
      -- which import_resolve_cliente would then hand to workflows/ideias inserts.
      -- Also turns a nonexistent id into a clear error instead of a downstream FK failure.
      if not found then
        raise exception 'cliente % does not belong to this workspace',
          (p_payload->>'mergeClienteId')::bigint;
      end if;
      -- record the mapping so later rows can resolve clienteRef{created:sourceKey}.
      -- provenance is carried here too so a merged cliente is not the one import
      -- outcome with no source traceability.
      insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key,
                                           ordinal, merged, provenance)
        values (p_job_id, p_conta_id, 'clientes', v_id, p_source_row_key,
                0, true, p_payload->'provenance');
      return jsonb_build_object('skipped', false, 'table', 'clientes', 'row_id', v_id);
    end if;
    -- LEGIBLE FAILURE for a missing/blank nome, raised BEFORE the insert below.
    -- clientes.nome is NOT NULL, so a row with no usable name fails regardless
    -- of this check -- the point is that it fails with a clear message naming
    -- the row instead of an opaque `null value in column "nome"` bubbling out
    -- of the insert (which the edge function's error handling can't safely
    -- return to the client either, per this repo's rule against leaking raw
    -- DB error text -- see the created_by guard above for the same pattern).
    if nullif(trim(coalesce(p_payload->>'nome', '')), '') is null then
      raise exception 'import row % has no usable nome (cliente name)', p_source_row_key;
    end if;
    insert into public.clientes (conta_id, user_id, nome, sigla, cor, plano, email, telefone,
                                 status, valor_mensal, especialidade, notion_page_url)
    values (p_conta_id, v_user_id, p_payload->>'nome',
            -- coalesce to '' before regexp_replace: p_payload->>'nome' is SQL NULL
            -- when the field is JSON null or absent, regexp_replace(NULL, ...) is
            -- NULL, and NULL || 'XX' is NULL (concatenation propagates NULL rather
            -- than treating it as empty) -- so an absent nome used to reach the
            -- insert with sigla = NULL and blow up on clientes' NOT NULL constraint
            -- on THAT column instead of the guard above. The guard now catches an
            -- absent/blank nome first, but this stays NULL-safe on its own so a
            -- nome that is present yet entirely non-alphabetic (e.g. "123") still
            -- falls back to the same 'XX' every other unusable name already gets.
            upper(left(regexp_replace(coalesce(p_payload->>'nome', ''), '[^a-zA-Z]', '', 'g') || 'XX', 2)),
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
    -- lower/trim first so casing and stray whitespace ('Agendado', ' postado ')
    -- don't fall through to the else branch below -- 'agendado'/'falha_publicacao'
    -- still can't survive the allow-list check regardless of how they're cased.
    v_status := lower(trim(coalesce(p_payload->>'status', 'rascunho')));
    if v_status not in ('rascunho', 'revisao_interna', 'aprovado_interno',
                        'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'postado') then
      v_status := 'rascunho';
    end if;
    -- The one date the row actually carries, whichever key it arrived under. It
    -- is BOTH the clamp's evidence and (when the clamp's verdict is 'postado')
    -- the published_at written below, so status and date can never disagree.
    v_source_at := coalesce((p_payload->>'publishedAt')::timestamptz,
                            (p_payload->>'scheduledAt')::timestamptz);
    if v_status = 'postado' and coalesce(v_source_at, now()) > now() then
      v_status := 'aprovado_cliente';
    end if;
    -- DATE COLUMNS DERIVE FROM THE CLAMPED VERDICT, NEVER FROM THE RAW PAYLOAD.
    -- Writing p_payload->>'publishedAt' unconditionally half-executed the clamp:
    -- a future-dated 'postado' row was downgraded to 'aprovado_cliente' and STILL
    -- got a published_at, and the CRM reads published_at alone as "this is live"
    -- (apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:1092 --
    -- `const isPublished = post.published_at != null`, no status check), so the
    -- row displayed as "Publicado em <future date>" while sitting unapproved.
    -- INVARIANT: published_at is non-null only when v_status = 'postado'.
    -- The source date is not discarded on a downgrade -- it moves to scheduled_at,
    -- so the downgraded post still lands on the calendar on the day the source
    -- tool said. Safe because the status clamp guarantees v_status is never
    -- 'agendado', and instagram-publish-cron/tiktok-publish-cron claim on that
    -- status, not on scheduled_at alone.
    if v_status = 'postado' then
      v_published_at := v_source_at;
      v_scheduled_at := (p_payload->>'scheduledAt')::timestamptz;
    else
      v_published_at := null;
      v_scheduled_at := coalesce((p_payload->>'scheduledAt')::timestamptz,
                                 (p_payload->>'publishedAt')::timestamptz);
    end if;
    -- SERVER-SIDE TIPO CLAMP, same reasoning as the status clamp above: `tipo` is
    -- CHECK-constrained to ('feed','reels','stories','carrossel')
    -- (20260402_workflow_posts.sql:19-20) and arrives in the same untrusted JSON blob.
    -- A CSV carrying 'Carrossel' / 'video' / 'Vídeo' would otherwise raise a
    -- constraint violation and lose the row. Unrecognized degrades to 'feed'.
    -- lower/trim first: 'Carrossel' (the clamp comment's own motivating example)
    -- must land as 'carrossel', not fall through to 'feed'.
    v_tipo := lower(trim(coalesce(p_payload->>'tipo', 'feed')));
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
            v_scheduled_at, v_published_at, 'human')
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
