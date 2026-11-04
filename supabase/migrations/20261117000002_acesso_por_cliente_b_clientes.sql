-- Acesso por cliente, Migração B (clientes): a tabela clientes, a view
-- clientes_v e a criação de cliente respeitam o escopo do membro.
-- Predicado: (my_client_scope_all() OR can_access_cliente(id)). O primeiro
-- termo é um initplan (subselect), então membro irrestrito não paga por linha.
-- Escrita nunca tem o "é dele": INSERT exige my_client_scope_all(), UPDATE tem
-- WITH CHECK explícito com o predicado.
-- Contexto do item dele em cliente oculto só pela RPC get_cliente_contexto,
-- nunca pela view nem pela tabela.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 1. Policies de clientes (ALTER POLICY mantém nome, comando e TO public)
-- -------------------------------------------------------------
ALTER POLICY clientes_select ON public.clientes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(id))
  );

ALTER POLICY clientes_update ON public.clientes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(id))
  );

ALTER POLICY clientes_delete ON public.clientes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(id))
  );

-- Restrito não cria cliente (inclui a conversão de lead, que é um INSERT
-- direto do CRM via addCliente: não existe RPC de conversão).
ALTER POLICY clientes_insert ON public.clientes
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.my_client_scope_all())
  );

-- -------------------------------------------------------------
-- 2. clientes_v
-- -------------------------------------------------------------
-- security_barrier, roda como dono (bypassa a RLS de clientes): o WHERE é a
-- única barreira. Mesma lista de colunas, na mesma ordem, de
-- 20261010100001_board_platforms.sql (a definição mais recente).
-- CREATE OR REPLACE VIEW mantém os grants. Nunca can_see_cliente_context aqui.
CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN (SELECT public.can_see_financials())
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url,
         c.send_event_email, c.event_email_unsub_at,
         c.plataformas_padrao
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id()
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(c.id));

-- -------------------------------------------------------------
-- 3. Contexto do item dele em cliente oculto
-- -------------------------------------------------------------
-- Só o que o item precisa para se apresentar (nome e marca), nunca a ficha.
-- Linha só quando can_see_cliente_context vale e o cliente é do workspace ativo.
CREATE OR REPLACE FUNCTION public.get_cliente_contexto(p_cliente_id bigint)
RETURNS TABLE(id bigint, nome text, sigla text, cor text, foto_url text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.nome, c.sigla, c.cor, c.foto_url
    FROM public.clientes c
   WHERE c.id = p_cliente_id
     AND c.conta_id = public.get_my_conta_id()
     AND public.can_see_cliente_context(p_cliente_id);
$$;
REVOKE ALL ON FUNCTION public.get_cliente_contexto(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cliente_contexto(bigint) TO authenticated;

-- -------------------------------------------------------------
-- 4. Import (data-import): restrito não cria cliente
-- -------------------------------------------------------------
-- Corpo idêntico ao de 20260729000004_data_import_jobs.sql, mais o gate no
-- ramo 'cliente'. CREATE OR REPLACE mantém o ACL (EXECUTE só service_role,
-- 20260925000001). get_client_health_aggregates é INVOKER e herda a policy
-- clientes_select: nada a mudar nela.
CREATE OR REPLACE FUNCTION public.import_commit_row(p_conta_id uuid, p_job_id bigint, p_source_row_key text, p_kind text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- ACESSO POR CLIENTE (defesa em profundidade): job de membro restrito
  -- ('atribuidos', não dono) não grava nada, em nenhum p_kind: nem cliente
  -- novo, nem merge (UPDATE pelo definer num cliente oculto), nem template,
  -- workflow, entrega, post ou ideia.
  -- A checagem do CHAMADOR fica no edge data-import, que recusa todo chamador restrito.
  -- Aqui o chamador é o service_role (auth.uid() NULL, então
  -- my_client_scope_all() daria true), por isso a checagem é sobre o criador
  -- do job, na conta do job. Criador sem linha em workspace_members na conta
  -- passa: a membership é conferida pelo edge antes de criar o job, e a suíte
  -- supabase/tests/import_commit_row.sql usa um criador assim.
  if exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = p_conta_id and wm.user_id = v_user_id
       and wm.role <> 'owner' and wm.client_scope = 'atribuidos'
  ) then
    raise exception 'client_scope_restricted';
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
        notion_page_url = coalesce(nullif(notion_page_url, ''), p_payload->>'notionPageUrl', notion_page_url),
        -- valor_mensal is `numeric`, nullable, no default (20260301_baseline_schema.sql:50)
        -- -- unlike the four text columns above, it has no empty-string state to
        -- test with nullif(col, ''): a numeric column is either NULL or a real
        -- number. The fill-only-empty test here is therefore `valor_mensal is
        -- null`, not `= 0`. This is deliberately conservative: 0 is a value this
        -- same function's own 'cliente' insert branch writes for a NEW client with
        -- no monthly value supplied (line ~279's `coalesce((...)::numeric, 0)`),
        -- and the CRM's own client-edit forms (ClientesPage.tsx, LeadsPage.tsx)
        -- write 0 for "no value entered" too -- so an existing row holding 0 is
        -- indistinguishable, from here, between "never set" and "a real $0/pro-bono
        -- client the workspace owner configured on purpose". Treating 0 as
        -- fillable risks silently overwriting the latter, which is worse than the
        -- bug this fixes. Only a genuine SQL NULL (a row untouched by any of those
        -- paths, e.g. one inserted directly) is filled from the payload; every
        -- non-null existing value, including 0, is left exactly as it was.
        valor_mensal = coalesce(valor_mensal, nullif(p_payload->>'valorMensal', '')::numeric)
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
    -- DEPENDENCY on the financial-visibility guard (20260728000002):
    -- clientes carries a BEFORE INSERT trigger (trg_guard_clientes_valor) that
    -- raises `financial_access_denied` for any INSERT supplying a NON-NULL
    -- valor_mensal when can_see_financials() is false. The valor_mensal below is
    -- coalesced to 0, so it is ALWAYS non-null and always trips that condition;
    -- the insert survives only because guard_financial_write returns early when
    -- auth.role() = 'service_role', and data-import/index.ts calls this RPC with
    -- the service-role key.
    --
    -- So: if this RPC is ever moved onto a user-scoped client — an otherwise
    -- reasonable hardening step — every cliente insert here starts failing for
    -- any admin without financial access, and the whole import aborts. Either
    -- keep the service-role caller, or drop the `coalesce(..., 0)` so an unmapped
    -- value inserts SQL NULL (the column is nullable with no default) and passes
    -- the guard on its own merits.
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
    if v_status = 'postado' and v_source_at is null then
      -- A dateless 'postado' row has no date for coalesce(v_source_at, now())
      -- > now() to ever compare against -- it collapses to `now() > now()`,
      -- which is always false, so the future-date branch below never fires
      -- and the row would land as status='postado' with published_at NULL,
      -- an internally inconsistent "published with nothing published" state.
      -- Downgrades to 'rascunho', mirroring the client-side clamp's own
      -- dateless case (apps/crm/src/pages/importar/buildCommitRows.ts's
      -- postRow: "Dateless rows import as unscheduled rascunho") -- not
      -- 'aprovado_cliente', which implies a date to schedule against.
      v_status := 'rascunho';
    elsif v_status = 'postado' and v_source_at > now() then
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
$function$;

-- -------------------------------------------------------------
-- 5. import_resolve_cliente: cliente resolvido acessível ao criador
-- -------------------------------------------------------------
-- Corpo de 20260729000004 mais a checagem de escopo. CREATE OR REPLACE mantém
-- o ACL (EXECUTE só service_role).
CREATE OR REPLACE FUNCTION public.import_resolve_cliente(p_conta_id uuid, p_job_id bigint, p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
  v_creator uuid;
begin
  if p_payload->'clienteRef'->>'type' = 'existing' then
    v_id := (p_payload->'clienteRef'->>'clienteId')::bigint;
    if not exists (select 1 from public.clientes where id = v_id and conta_id = p_conta_id) then
      raise exception 'cliente % does not belong to this workspace', v_id;
    end if;
  else
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
  end if;
  -- ACESSO POR CLIENTE: o cliente resolvido (existing ou created) tem que ser
  -- acessível ao criador do job, pelo núcleo service-role do predicado. Só
  -- barra criador com membership na conta (sem membership: ver o comentário
  -- em import_commit_row).
  select created_by into v_creator from public.import_jobs
   where id = p_job_id and conta_id = p_conta_id;
  if exists (select 1 from public.workspace_members wm
              where wm.workspace_id = p_conta_id and wm.user_id = v_creator)
     and not public.can_access_cliente(v_creator, p_conta_id, v_id) then
    raise exception 'client_scope_restricted';
  end if;
  return v_id;
end;
$function$;

-- -------------------------------------------------------------
-- 6. Sub-tabelas da ficha do cliente (datas, endereços, links)
-- -------------------------------------------------------------
-- Leitura, DELETE e o USING do UPDATE ganham o predicado; os quals
-- existentes ficam. INSERT e o WITH CHECK do UPDATE já barravam cliente oculto
-- pelo EXISTS (SELECT 1 FROM clientes ...), que herda a RLS de clientes; o
-- predicado entra explícito também neles porque as três são tabelas raiz
-- (cliente_id próprio) e a guarda de deriva exige o predicado no WITH CHECK
-- de raiz, sem depender de uma subconsulta.
ALTER POLICY workspace_read_datas ON public.cliente_datas
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_delete_datas ON public.cliente_datas
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_datas ON public.cliente_datas
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_read_enderecos ON public.cliente_enderecos
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_delete_enderecos ON public.cliente_enderecos
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_enderecos ON public.cliente_enderecos
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_select_links ON public.cliente_links
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_delete_links ON public.cliente_links
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_links ON public.cliente_links
  USING (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_insert_datas ON public.cliente_datas
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_datas.cliente_id AND c.conta_id = cliente_datas.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_datas ON public.cliente_datas
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_datas.cliente_id AND c.conta_id = cliente_datas.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_insert_enderecos ON public.cliente_enderecos
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_enderecos.cliente_id AND c.conta_id = cliente_enderecos.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_enderecos ON public.cliente_enderecos
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_enderecos.cliente_id AND c.conta_id = cliente_enderecos.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_insert_links ON public.cliente_links
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_links.cliente_id AND c.conta_id = cliente_links.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workspace_update_links ON public.cliente_links
  WITH CHECK (
    conta_id IN (SELECT workspace_members.workspace_id FROM public.workspace_members
                  WHERE workspace_members.user_id = auth.uid())
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = cliente_links.cliente_id AND c.conta_id = cliente_links.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
