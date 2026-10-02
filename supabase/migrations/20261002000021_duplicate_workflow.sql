-- supabase/migrations/20261002000021_duplicate_workflow.sql
-- Duplicar fluxo (spec docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md).
--
-- Copia o fluxo no estado atual: mesmas etapas e datas, mesma coluna, logo
-- depois do original. Opcoes por fluxo ganham option_id novo e os valores dos
-- posts sao remapeados. Cada post passa por _clone_post_row (20261002000020)
-- com p_solo = false: sem sufixo, mesma ordem, sem ranque no quadro.
-- Nao copia portal_tokens nem o historico de workflow_events (o trigger de
-- "created" registra a criacao normalmente).

CREATE OR REPLACE FUNCTION public.duplicate_workflow(p_workflow_id bigint, p_to_rascunho boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  w       workflows%ROWTYPE;
  v_new   bigint;
  o       record;
  v_opt   uuid;
  v_map   jsonb := '{}'::jsonb;
  p       record;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT * INTO w FROM workflows
   WHERE id = p_workflow_id AND conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Logo depois do original: empurrar todos os posteriores da conta preserva a
  -- ordem relativa em todas as colunas. position nao gera evento.
  -- Fluxos e cards de processo avulso dividem UM espaco de indices por coluna
  -- (reorder_fluxos_board, 20260919000008), entao os dois sao empurrados; so
  -- ativo/concluido viram card, mesmo filtro da RPC de reordenar.
  IF w.position IS NOT NULL THEN
    UPDATE workflows SET position = position + 1
     WHERE conta_id = v_conta AND position > w.position;
    UPDATE post_processes SET board_position = board_position + 1
     WHERE conta_id = v_conta AND estado IN ('ativo', 'concluido')
       AND board_position > w.position;
  END IF;

  INSERT INTO workflows (
    user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
    recorrente, position, modo_prazo, link_notion, link_drive, concluido_em,
    created_via)
  VALUES (
    auth.uid(), v_conta, w.cliente_id, w.titulo || ' (cópia)', w.template_id,
    w.status, w.etapa_atual, w.recorrente,
    CASE WHEN w.position IS NULL THEN NULL ELSE w.position + 1 END,
    w.modo_prazo, w.link_notion, w.link_drive, w.concluido_em, 'human')
  RETURNING id INTO v_new;

  INSERT INTO workflow_etapas (
    workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
    status, iniciado_em, concluido_em, data_limite)
  SELECT v_new, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo, e.responsavel_id,
         e.tipo, e.status, e.iniciado_em, e.concluido_em, e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = w.id
   ORDER BY e.ordem, e.id;

  -- workflow_select_options so tem RLS pelo conta_id da propria linha: filtrar
  -- por conta (e pela definicao) impede copiar linha forjada por outra conta.
  FOR o IN
    SELECT wso.* FROM workflow_select_options wso
     WHERE wso.workflow_id = w.id
       AND wso.conta_id = v_conta
       AND EXISTS (SELECT 1 FROM template_property_definitions d
                    WHERE d.id = wso.property_definition_id AND d.conta_id = v_conta)
     ORDER BY wso.id
  LOOP
    INSERT INTO workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    VALUES (v_new, o.property_definition_id, v_conta, o.label, o.color)
    RETURNING option_id INTO v_opt;
    v_map := v_map || jsonb_build_object(o.option_id::text, v_opt::text);
  END LOOP;

  FOR p IN
    SELECT id FROM workflow_posts
     WHERE workflow_id = w.id AND conta_id = v_conta
     ORDER BY ordem, id
  LOOP
    PERFORM public._clone_post_row(v_conta, p.id, v_new, coalesce(p_to_rascunho, false), v_map, false);
  END LOOP;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_workflow(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_workflow(bigint, boolean) TO authenticated, service_role;
