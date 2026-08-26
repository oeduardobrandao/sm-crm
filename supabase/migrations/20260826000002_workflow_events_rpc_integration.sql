-- =====================================================================
-- 20260826000002_workflow_events_rpc_integration.sql
-- Wires workflow_events (20260826000001) into two RPCs:
--   Part A: recreates migrate_workflow_template (verbatim body from
--     20260819000010_workflow_template_migration.sql) + suppresses the
--     row-level triggers for its internal writes + emits exactly one
--     dedicated `template_migrado` event instead of the raw
--     `etapa_iniciada` noise the (now-suppressed) etapa activation
--     UPDATE would otherwise produce.
--   Part B: new RPC propagate_template_to_workflows, replacing the
--     client-side loop in apps/crm/src/store/workflows.ts
--     (propagateTemplateToWorkflows) with one atomic server-side pass +
--     one `template_propagado` event per affected workflow instead of
--     one `etapa_editada` per updated etapa.
-- =====================================================================

-- ============================================================
-- Part A — migrate_workflow_template
-- ============================================================
-- migrate_workflow_template — troca atômica do template de um fluxo.
-- Spec: docs/superpowers/specs/2026-08-19-workflow-template-migration-design.md
--   1. copia post_property_values para as definições do destino por nome+tipo
--      (case-insensitive, trim; select/multiselect/status NUNCA casam, pois seus
--      valores guardam ids de opção gerados por template). INSERT + ON CONFLICT
--      DO NOTHING em vez de UPDATE: duas definições de origem casando com a
--      mesma de destino fariam um UPDATE colidir consigo mesmo no UNIQUE
--      (post_id, property_definition_id). Desempate determinístico por menor
--      display_order e depois menor id da definição de ORIGEM.
--   2. snapshota o que se perde (órfãos + perdedores de conflito) para o audit_log
--   3. apaga todos os valores restantes sob definições do template origem
--   4. apaga as workflow_select_options do template origem (tipos de opção nunca casam)
--   5. arquiva portal_approvals legadas (tabela sem writer atual; a cascata do
--      delete da escada as apagaria em silêncio) no metadata
--   6. substitui a escada; a etapa ativa é inserida 'pendente' e ativada por
--      UPDATE para o trigger notify_step_activated (AFTER UPDATE) disparar
--   7. atualiza workflows (template_id, etapa_atual, modo_prazo)
--   8. grava audit_log (SECURITY DEFINER cobre o insert; RLS ali é service_role-only)
--   9. grava workflow_events.template_migrado (best-effort; ver 20260826000001)
-- Guarda de concorrência: p_expected_template_id é o template_id que o cliente
-- viu, e p_expected_etapa_atual é a etapa_atual que o cliente viu; divergência
-- em qualquer um dos dois = workflow_changed (duas migrações, ou uma migração
-- concorrente com um avanço de etapa, não se sobrescrevem caladas).
-- Erros: mensagens-código estáveis consumidas pelo frontend (mapMigrationError).
--
-- workflow_events note: this function suppresses Trigger A/B/C (row-level
-- capture on workflows/workflow_etapas from 20260826000001) for the duration
-- of its writes and emits exactly one `template_migrado` event instead,
-- anchored on the newly-activated etapa (v_active_id) since the etapa-level
-- activation UPDATE below is now silent.
-- ============================================================

DROP FUNCTION IF EXISTS public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint);

CREATE OR REPLACE FUNCTION public.migrate_workflow_template(
  p_workflow_id           bigint,
  p_template_id           bigint,
  p_new_etapas            jsonb,
  p_active_ordem          integer,
  p_modo_prazo            text,
  p_expected_template_id  bigint,
  p_expected_etapa_atual  integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_wf record;
  v_old_template_id bigint;
  v_n integer;
  v_i integer := 0;
  v_etapa jsonb;
  v_nome text;
  v_prazo integer;
  v_resp bigint;
  v_etapa_id bigint;
  v_active_id bigint;
  v_data_limite date;
  v_old_etapas jsonb;
  v_dropped_names text[] := '{}';
  v_dropped_values jsonb := '[]'::jsonb;
  v_legacy_approvals jsonb := '[]'::jsonb;
  -- workflow_events additions (Part A of 20260826000002)
  v_from_template_nome text;
  v_to_template_nome text;
  v_active_nome text;
  v_event_metadata jsonb;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT id, template_id, status, etapa_atual INTO v_wf
    FROM workflows
    WHERE id = p_workflow_id AND conta_id = v_conta
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  IF v_wf.template_id IS DISTINCT FROM p_expected_template_id
     OR v_wf.etapa_atual IS DISTINCT FROM p_expected_etapa_atual THEN
    RAISE EXCEPTION 'workflow_changed';
  END IF;
  IF v_wf.status <> 'ativo' THEN RAISE EXCEPTION 'workflow_not_active'; END IF;
  v_old_template_id := v_wf.template_id;

  -- migrar para o próprio template seria um no-op destrutivo (apagaria os
  -- timestamps da escada sem mudar nada); a UI nem oferece, a RPC também barra
  IF v_old_template_id IS NOT NULL AND p_template_id = v_old_template_id THEN
    RAISE EXCEPTION 'same_template';
  END IF;

  PERFORM 1 FROM workflow_templates WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  -- NULL explícito nos IFs: em plpgsql um IF com expressão NULL é pulado
  -- (lógica trivalente), então sem estas guardas um p_modo_prazo/p_active_ordem
  -- nulo atravessaria as validações e deixaria o fluxo sem etapa ativa
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'invalid_modo_prazo';
  END IF;

  IF p_new_etapas IS NULL OR jsonb_typeof(p_new_etapas) <> 'array' THEN
    RAISE EXCEPTION 'empty_etapas';
  END IF;
  v_n := jsonb_array_length(p_new_etapas);
  IF v_n = 0 THEN RAISE EXCEPTION 'empty_etapas'; END IF;
  IF p_active_ordem IS NULL OR p_active_ordem < 0 OR p_active_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_active_ordem';
  END IF;

  -- Addition #1 (20260826000002): suppress Trigger A/B/C for the rest of
  -- this function's writes (etapa DELETE+reinsert, the re-activation
  -- UPDATE, and the final workflows UPDATE below). Transaction-local
  -- (third arg `true`) -- resets at COMMIT/ROLLBACK, never leaks to other
  -- transactions or connections.
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  IF v_old_template_id IS NOT NULL AND v_old_template_id <> p_template_id THEN
    -- ---- 1. copia valores para as definições casadas do destino ----
    WITH m AS (
      SELECT DISTINCT ON (o.id)
             o.id AS old_id, o.display_order AS old_display_order, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name, E' \t\r\n')) = lower(btrim(o.name, E' \t\r\n'))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    )
    INSERT INTO post_property_values (post_id, property_definition_id, value)
    SELECT DISTINCT ON (pv.post_id, m.new_id) pv.post_id, m.new_id, pv.value
    FROM post_property_values pv
    JOIN m ON m.old_id = pv.property_definition_id
    WHERE pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
    ORDER BY pv.post_id, m.new_id, m.old_display_order, m.old_id
    ON CONFLICT (post_id, property_definition_id) DO NOTHING;

    -- ---- 2. snapshot do que se perde (órfãos + perdedores de conflito) ----
    WITH m AS (
      SELECT DISTINCT ON (o.id) o.id AS old_id, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name, E' \t\r\n')) = lower(btrim(o.name, E' \t\r\n'))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    ),
    perdas AS (
      SELECT pv.post_id, d.name, pv.value
      FROM post_property_values pv
      JOIN template_property_definitions d ON d.id = pv.property_definition_id
      LEFT JOIN m ON m.old_id = pv.property_definition_id
      WHERE d.template_id = v_old_template_id
        AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
        AND (m.new_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM post_property_values x
          WHERE x.post_id = pv.post_id
            AND x.property_definition_id = m.new_id
            AND x.value IS NOT DISTINCT FROM pv.value))
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'post_id', post_id, 'name', name, 'value', value)), '[]'::jsonb),
           coalesce(array_agg(DISTINCT name), '{}')
      INTO v_dropped_values, v_dropped_names
    FROM perdas;

    -- ---- 3. apaga todos os valores sob definições do template origem ----
    DELETE FROM post_property_values pv
    USING template_property_definitions d
    WHERE d.id = pv.property_definition_id
      AND d.template_id = v_old_template_id
      AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id);

    -- ---- 4. select options do template origem (tipos de opção nunca casam) ----
    DELETE FROM workflow_select_options wso
    USING template_property_definitions d
    WHERE d.id = wso.property_definition_id
      AND d.template_id = v_old_template_id
      AND wso.workflow_id = p_workflow_id;
  END IF;

  -- ---- 5. arquiva portal_approvals legadas antes da cascata ----
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'portal_approval_id', pa.id,
           'workflow_etapa_id', pa.workflow_etapa_id,
           'etapa_nome', we.nome,
           'action', pa.action,
           'comentario', pa.comentario,
           'created_at', pa.created_at)), '[]'::jsonb)
    INTO v_legacy_approvals
  FROM portal_approvals pa
  JOIN workflow_etapas we ON we.id = pa.workflow_etapa_id
  WHERE we.workflow_id = p_workflow_id;

  -- ---- 6. escada ----
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ordem), '[]'::jsonb) INTO v_old_etapas
  FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  DELETE FROM workflow_etapas WHERE workflow_id = p_workflow_id;

  FOR v_etapa IN SELECT * FROM jsonb_array_elements(p_new_etapas) LOOP
    v_nome := btrim(coalesce(v_etapa->>'nome', ''));
    IF v_nome = '' THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    BEGIN
      v_prazo := (v_etapa->>'prazo_dias')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;
    IF v_prazo IS NULL OR v_prazo < 0 THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    IF coalesce(v_etapa->>'tipo_prazo', '') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;
    IF coalesce(v_etapa->>'tipo', 'padrao') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;

    BEGIN
      v_resp := NULLIF(v_etapa->>'responsavel_id', '')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_responsavel';
    END;
    IF v_resp IS NOT NULL THEN
      PERFORM 1 FROM membros WHERE id = v_resp AND conta_id = v_conta;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_responsavel'; END IF;
    END IF;

    BEGIN
      v_data_limite := NULLIF(v_etapa->>'data_limite', '')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;

    -- a etapa ativa entra como 'pendente' e é ativada por UPDATE no fim do loop,
    -- para o trigger notify_step_activated (AFTER UPDATE) disparar
    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
       status, iniciado_em, concluido_em, data_limite)
    VALUES
      (p_workflow_id, v_i, v_nome, v_prazo, v_etapa->>'tipo_prazo', v_resp,
       coalesce(v_etapa->>'tipo', 'padrao'),
       CASE WHEN v_i < p_active_ordem THEN 'concluido' ELSE 'pendente' END,
       NULL, NULL,
       v_data_limite)
    RETURNING id INTO v_etapa_id;
    IF v_i = p_active_ordem THEN v_active_id := v_etapa_id; END IF;
    v_i := v_i + 1;
  END LOOP;

  UPDATE workflow_etapas
  SET status = 'ativo', iniciado_em = now()
  WHERE id = v_active_id;

  -- ---- 7. workflow ----
  UPDATE workflows
  SET template_id = p_template_id, etapa_atual = p_active_ordem, modo_prazo = p_modo_prazo
  WHERE id = p_workflow_id;

  -- ---- 8. auditoria ----
  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta, auth.uid(), 'workflow.template_migrated', 'workflow', p_workflow_id::text,
    jsonb_build_object(
      'from_template_id', v_old_template_id,
      'to_template_id', p_template_id,
      'modo_prazo', p_modo_prazo,
      'active_ordem', p_active_ordem,
      'old_etapas', v_old_etapas,
      'dropped_property_names', to_jsonb(v_dropped_names),
      'dropped_property_values', v_dropped_values,
      'legacy_portal_approvals', v_legacy_approvals));

  -- ---- 9. workflow_events: template_migrado (Addition #2, 20260826000002) ----
  -- Best-effort, mirrors the trigger philosophy in 20260826000001: a
  -- failure recording this summary event must never fail or roll back the
  -- migration itself, so it is isolated in its own exception block,
  -- separate from the rest of the function.
  BEGIN
    v_from_template_nome := NULL;
    IF v_old_template_id IS NOT NULL THEN
      SELECT nome INTO v_from_template_nome
      FROM workflow_templates
      WHERE id = v_old_template_id AND conta_id = v_conta;
    END IF;

    v_to_template_nome := NULL;
    SELECT nome INTO v_to_template_nome
    FROM workflow_templates
    WHERE id = p_template_id AND conta_id = v_conta;

    v_active_nome := NULL;
    SELECT nome INTO v_active_nome FROM workflow_etapas WHERE id = v_active_id;

    v_event_metadata := jsonb_build_object(
      'from_template_id', v_old_template_id,
      'to_template_id', p_template_id,
      'modo_prazo', p_modo_prazo,
      'active_ordem', p_active_ordem
    );
    IF v_from_template_nome IS NOT NULL THEN
      v_event_metadata := v_event_metadata || jsonb_build_object('from_template_nome', v_from_template_nome);
    END IF;
    IF v_to_template_nome IS NOT NULL THEN
      v_event_metadata := v_event_metadata || jsonb_build_object('to_template_nome', v_to_template_nome);
    END IF;

    PERFORM record_workflow_event(
      p_workflow_id, v_conta, 'template_migrado', v_active_id, v_active_nome, v_event_metadata
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'migrate_workflow_template: failed to record template_migrado event for workflow %: %', p_workflow_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint, integer)
  TO authenticated, service_role;

-- ============================================================
-- Part B — propagate_template_to_workflows (new RPC)
-- ============================================================
-- Server-side replacement for apps/crm/src/store/workflows.ts's
-- propagateTemplateToWorkflows client-side loop (a later task rewrites
-- the frontend to call this RPC instead). Replicates that function's
-- semantics exactly -- read the TS function and its inline comments,
-- which are the behavioral spec:
--   - only 'ativo' workflows whose template_id = p_template_id are touched
--   - 'concluido' etapas are never touched
--   - for 'pendente'/'ativo' etapas, the matching template etapa is found
--     by 0-based array index against p_template_id's ordem (jsonb `->`
--     uses 0-based indexing, same as the TS `etapas[wfEtapa.ordem]`); a
--     missing match (workflow has more/fewer steps than the template) is
--     silently skipped, never an error
--   - nome, prazo_dias, tipo_prazo, responsavel_id sync on both 'pendente'
--     and 'ativo' etapas
--   - tipo syncs ONLY on 'pendente' etapas (never 'ativo' -- an
--     in-progress client-approval gate must not change type mid-flight)
--   - status, iniciado_em, concluido_em are never touched
--
-- Tenant isolation (P1 from prior review, mandatory): workflows.template_id
-- is a global-scope FK with no RLS tie to the referencing workflow's own
-- tenant. Step 2 below checks the template belongs to the caller's conta,
-- but that alone is NOT sufficient -- a workflow in a *different* conta
-- could still point its template_id at this template's id (corrupted data,
-- or a crafted value), so the workflow selection below filters on BOTH
-- template_id AND conta_id = v_conta, and every subsequent
-- workflow_etapas UPDATE is scoped to that conta-and-template-filtered
-- workflow id set -- never a bare `workflow_id IN (select id from
-- workflows where template_id = p_template_id)`.
--
-- Suppresses Trigger A/B/C the same way migrate_workflow_template does,
-- and emits one `template_propagado` workflow_events row per workflow
-- that had at least one etapa actually updated (never one per etapa).
-- Steps 4-5 (the actual propagation) run outside any swallowing exception
-- handler -- a real failure (e.g. a constraint violation) must surface to
-- the caller as a normal Postgres error. Only the history-recording call
-- in step 6 is best-effort.
-- ============================================================

CREATE OR REPLACE FUNCTION public.propagate_template_to_workflows(
  p_template_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_etapas jsonb;
  v_template_nome text;
  v_wf record;
  v_etapa record;
  v_tpl_etapa jsonb;
  v_updated_count integer;
  v_rows integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  -- Step 2: template must belong to the caller's own workspace.
  SELECT etapas, nome INTO v_etapas, v_template_nome
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  -- Step 3: suppress Trigger A/B/C for the etapa UPDATEs below.
  -- Transaction-local (third arg `true`).
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  -- Step 4: target workflows -- conta_id filter is the mandatory tenant
  -- boundary described above, NOT redundant with the template check.
  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id
      AND conta_id = v_conta
      AND status = 'ativo'
  LOOP
    -- Re-validate under a row lock: a concurrent migrate_workflow_template
    -- could have changed this workflow's template_id/status (and replaced
    -- its etapas entirely) between the outer cursor's snapshot above and
    -- this iteration -- READ COMMITTED means the inner etapa SELECT below
    -- gets its OWN fresh snapshot, not the outer cursor's, so it could see
    -- a freshly-migrated, different-template-shaped ladder while this
    -- iteration still writes p_template_id's field values onto it.
    -- migrate_workflow_template takes FOR UPDATE on this same workflows
    -- row before any destructive work, so this lock genuinely serializes
    -- against it: if a migration is concurrently in flight, this blocks
    -- until it commits, then re-checks the LATEST row version and skips
    -- (CONTINUE) if template_id/status no longer match; if we get here
    -- first, a concurrent migration blocks on this row until we're done.
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_updated_count := 0;

    -- Step 5: per-etapa propagation, scoped to this conta-and-template
    -- filtered workflow's own id (v_wf.id comes from the query above).
    FOR v_etapa IN
      SELECT id, ordem, status
      FROM workflow_etapas
      WHERE workflow_id = v_wf.id
        AND status IN ('pendente', 'ativo')
      ORDER BY ordem
    LOOP
      -- 0-based index match, same as the TS `etapas[wfEtapa.ordem]`; a
      -- miss (index out of range on either side) is skipped, not an error.
      v_tpl_etapa := v_etapas -> v_etapa.ordem;
      IF v_tpl_etapa IS NULL OR jsonb_typeof(v_tpl_etapa) <> 'object' THEN
        CONTINUE;
      END IF;

      -- TOCTOU guard: the outer cursor's SELECT snapshotted `status` when
      -- the loop started. A concurrent write (e.g. the frontend completing
      -- this exact etapa) between that read and this UPDATE must not be
      -- silently overwritten, so the WHERE clause re-checks status = the
      -- value this iteration actually read, making the write a no-op if it
      -- changed. v_rows (via GET DIAGNOSTICS) reflects the real outcome,
      -- not an unconditional per-iteration increment.
      IF v_etapa.status = 'pendente' THEN
        UPDATE workflow_etapas
        SET nome = v_tpl_etapa->>'nome',
            prazo_dias = (v_tpl_etapa->>'prazo_dias')::integer,
            tipo_prazo = v_tpl_etapa->>'tipo_prazo',
            responsavel_id = NULLIF(v_tpl_etapa->>'responsavel_id', '')::bigint,
            tipo = coalesce(v_tpl_etapa->>'tipo', 'padrao')
        WHERE id = v_etapa.id AND status = v_etapa.status;
      ELSE
        -- 'ativo': never touch tipo (in-progress approval gate).
        UPDATE workflow_etapas
        SET nome = v_tpl_etapa->>'nome',
            prazo_dias = (v_tpl_etapa->>'prazo_dias')::integer,
            tipo_prazo = v_tpl_etapa->>'tipo_prazo',
            responsavel_id = NULLIF(v_tpl_etapa->>'responsavel_id', '')::bigint
        WHERE id = v_etapa.id AND status = v_etapa.status;
      END IF;
      GET DIAGNOSTICS v_rows = ROW_COUNT;

      v_updated_count := v_updated_count + v_rows;
    END LOOP;

    -- Step 6: one template_propagado event per workflow actually touched,
    -- best-effort, isolated from the propagation logic above.
    IF v_updated_count > 0 THEN
      BEGIN
        PERFORM record_workflow_event(
          v_wf.id, v_conta, 'template_propagado', NULL, NULL,
          jsonb_build_object(
            'template_id', p_template_id,
            'template_nome', v_template_nome,
            'etapas_atualizadas', v_updated_count
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'propagate_template_to_workflows: failed to record template_propagado event for workflow %: %', v_wf.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_template_to_workflows(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_template_to_workflows(bigint) TO authenticated, service_role;
