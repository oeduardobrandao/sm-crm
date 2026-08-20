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
-- Guarda de concorrência: p_expected_template_id é o template_id que o cliente
-- viu; divergência = workflow_changed (duas migrações não se sobrescrevem caladas).
-- Erros: mensagens-código estáveis consumidas pelo frontend (mapMigrationError).
-- ============================================================

CREATE OR REPLACE FUNCTION public.migrate_workflow_template(
  p_workflow_id          bigint,
  p_template_id          bigint,
  p_new_etapas           jsonb,
  p_active_ordem         integer,
  p_modo_prazo           text,
  p_expected_template_id bigint
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
  v_old_etapas jsonb;
  v_dropped_names text[] := '{}';
  v_dropped_values jsonb := '[]'::jsonb;
  v_legacy_approvals jsonb := '[]'::jsonb;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT id, template_id, status INTO v_wf
    FROM workflows
    WHERE id = p_workflow_id AND conta_id = v_conta
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  IF v_wf.template_id IS DISTINCT FROM p_expected_template_id THEN
    RAISE EXCEPTION 'workflow_changed';
  END IF;
  IF v_wf.status <> 'ativo' THEN RAISE EXCEPTION 'workflow_not_active'; END IF;
  v_old_template_id := v_wf.template_id;

  PERFORM 1 FROM workflow_templates WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  IF p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'invalid_modo_prazo';
  END IF;

  v_n := jsonb_array_length(p_new_etapas);
  IF v_n IS NULL OR v_n = 0 THEN RAISE EXCEPTION 'empty_etapas'; END IF;
  IF p_active_ordem < 0 OR p_active_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_active_ordem';
  END IF;

  IF v_old_template_id IS NOT NULL AND v_old_template_id <> p_template_id THEN
    -- ---- 1. copia valores para as definições casadas do destino ----
    WITH m AS (
      SELECT DISTINCT ON (o.id)
             o.id AS old_id, o.display_order AS old_display_order, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name)) = lower(btrim(o.name))
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
       AND lower(btrim(n.name)) = lower(btrim(o.name))
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
            AND x.value = pv.value))
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

    v_resp := NULLIF(v_etapa->>'responsavel_id', '')::bigint;
    IF v_resp IS NOT NULL THEN
      PERFORM 1 FROM membros WHERE id = v_resp AND conta_id = v_conta;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_responsavel'; END IF;
    END IF;

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
       NULLIF(v_etapa->>'data_limite', '')::date)
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
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.migrate_workflow_template(bigint, bigint, jsonb, integer, text, bigint)
  TO authenticated, service_role;
