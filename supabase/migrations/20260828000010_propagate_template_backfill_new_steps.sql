-- ============================================================
-- propagate_template_to_workflows: backfill de etapas novas do template
-- ============================================================
-- Porta para o RPC server-side o backfill que existia na versao client-side
-- de propagateTemplateToWorkflows (commit a5883ea5, nunca mergeado porque a
-- funcao inteira migrou para este RPC antes): quando o template ganha uma
-- etapa nova (ex.: adicionar "Publicação" depois de "Agendamento"), os fluxos
-- ativos criados antes da edicao nao tinham como receber a etapa -- completavam
-- na antiga etapa final e nunca viam a nova. Agora, alem de sincronizar as
-- etapas existentes, o RPC insere como 'pendente' qualquer ordem do template
-- que ainda nao tem linha correspondente em workflow_etapas no fluxo.
--
-- Semantica do backfill (igual ao client-side de a5883ea5):
--   - a checagem de "ja existe" considera QUALQUER status (uma etapa
--     'concluido' na ordem N conta como existente -- nunca duplicar);
--   - a linha nova copia nome, prazo_dias, tipo_prazo, responsavel_id e tipo
--     do template; status = 'pendente', iniciado_em/concluido_em = NULL;
--   - data_limite NUNCA e atribuido: no modo data_entrega nao ha data de
--     entrega para ancorar no meio do ciclo, e nos modos padrao/data_fixa ele
--     simplesmente fica sem definir -- mesmo raciocinio do caminho de UPDATE;
--   - tipo_prazo/tipo caem nos defaults ('corridos'/'padrao') quando ausentes
--     no jsonb, espelhando o client-side antigo (o insert via PostgREST omitia
--     a chave undefined e o DEFAULT da coluna aplicava);
--   - entradas do array que nao sao objetos sao ignoradas, como no loop de
--     UPDATE; um objeto sem nome/prazo_dias viola NOT NULL e o erro sobe ao
--     caller normalmente (falha real nunca e engolida, igual ao caminho de
--     UPDATE).
--
-- Concorrencia: o INSERT roda dentro da iteracao por fluxo que ja segura o
-- lock FOR UPDATE na linha de workflows (fix do TOCTOU do cursor externo),
-- entao esta genuinamente serializado contra migrate_workflow_template (que
-- substitui a escada inteira) e contra outra chamada concorrente deste mesmo
-- RPC. O anti-duplicata e um unico statement (INSERT ... SELECT ... WHERE NOT
-- EXISTS), sem janela read-then-write dentro da funcao. Nao existe indice
-- unico em (workflow_id, ordem), entao um INSERT manual concorrente de etapa
-- pelo app nao e excluido -- exposicao pre-existente de todo escritor dessa
-- tabela, identica a do client-side antigo, nao introduzida aqui.
--
-- Evento: um fluxo que so recebeu backfill (zero updates) conta como "tocado"
-- e emite template_propagado; metadata ganha 'etapas_criadas' ao lado de
-- 'etapas_atualizadas' (o frontend renderiza so template_nome, entao a chave
-- nova e aditiva e nao quebra eventos antigos).
--
-- Fora o backfill, o corpo abaixo e identico ao de
-- 20260826000002_workflow_events_rpc_integration.sql (Part B) com os dois
-- fixes de TOCTOU ja aplicados; o comentario-spec da Part B continua valendo,
-- exceto a frase "a missing match is silently skipped" no sentido
-- template->fluxo: uma etapa do template sem linha no fluxo agora e
-- backfillada (o sentido fluxo->template -- fluxo com mais etapas que o
-- template -- continua sendo pulado em silencio).
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
  v_inserted_count integer;
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
    v_inserted_count := 0;

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

    -- Step 5b: backfill template steps this workflow has no row for yet, as
    -- 'pendente' -- this is what makes appending a new step to a template
    -- reach workflows created before the edit; without it they complete at
    -- their old final step and never surface the new one. Runs AFTER the
    -- update loop so freshly-inserted rows are never re-processed by it.
    -- Single statement: the existence check (any status, including
    -- 'concluido') and the INSERT share one snapshot, and the FOR UPDATE
    -- lock on the workflows row above serializes this against
    -- migrate_workflow_template and concurrent propagate calls. data_limite
    -- is deliberately NULL -- there is no delivery date to anchor a deadline
    -- to mid-cycle (data_entrega mode), and it is simply unset for
    -- padrao/data_fixa; the next cycle assigns it normally.
    IF jsonb_typeof(v_etapas) = 'array' THEN
      INSERT INTO workflow_etapas
        (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
         tipo, status, iniciado_em, concluido_em, data_limite)
      SELECT v_wf.id,
             (t.idx - 1)::integer,
             t.etapa->>'nome',
             (t.etapa->>'prazo_dias')::integer,
             coalesce(t.etapa->>'tipo_prazo', 'corridos'),
             NULLIF(t.etapa->>'responsavel_id', '')::bigint,
             coalesce(t.etapa->>'tipo', 'padrao'),
             'pendente', NULL, NULL, NULL
      FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS t(etapa, idx)
      WHERE jsonb_typeof(t.etapa) = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM workflow_etapas we
          WHERE we.workflow_id = v_wf.id
            AND we.ordem = (t.idx - 1)::integer
        );
      GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    END IF;

    -- Step 6: one template_propagado event per workflow actually touched,
    -- best-effort, isolated from the propagation logic above. A workflow
    -- that only received backfilled steps counts as touched.
    IF v_updated_count + v_inserted_count > 0 THEN
      BEGIN
        PERFORM record_workflow_event(
          v_wf.id, v_conta, 'template_propagado', NULL, NULL,
          jsonb_build_object(
            'template_id', p_template_id,
            'template_nome', v_template_nome,
            'etapas_atualizadas', v_updated_count,
            'etapas_criadas', v_inserted_count
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'propagate_template_to_workflows: failed to record template_propagado event for workflow %: %', v_wf.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

-- CREATE OR REPLACE preserves the ACLs set by 20260826000002, but restate
-- them so this migration stands alone if the function is ever recreated.
REVOKE ALL ON FUNCTION public.propagate_template_to_workflows(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.propagate_template_to_workflows(bigint) TO authenticated, service_role;
