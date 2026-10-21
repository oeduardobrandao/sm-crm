-- 20261021120000_clone_flow_future_etapas_from_template.sql
-- "Duplicar fluxo" e a continuação (mover posts para um fluxo novo) montam as
-- etapas FUTURAS do fluxo novo a partir do template, não da origem.
--
-- Por quê: duplicate_workflow (20261010100005) e move_posts_to_new_flow
-- (20261010100004) copiam a escada de etapas da origem linha a linha. Uma origem
-- com etapas duplicadas ou fora de ordem (a "Agendamento" a mais da Maven,
-- 2026-10-16; as escadas embaralhadas da Yas Design e da Agência Be, limpas em
-- 2026-10-21) passava o defeito para todo fluxo novo tirado dela. A Agência Be
-- mantém dois fluxos assim de propósito (2568 e 2543), então a origem ruim
-- continua existindo.
--
-- O que muda: depois de copiar as etapas, as duas RPCs chamam
-- _realign_pending_etapas_to_template(fluxo novo). Ele acha p = posição no
-- template do nome da etapa ativa e troca as pendentes acima dela por
-- template[p+1..], nas ordens seguintes (sem buraco: o CRM avança por ordem + 1).
-- Responsável, prazo, tipo de prazo, tipo e data limite de uma pendente antiga
-- com o mesmo nome (a primeira ainda não usada) passam para a nova; o resto vem
-- do template. Nomes comparados com trim_etapa_nome (20261021000010).
--
-- Não faz nada (a cópia fica como era) quando: o fluxo não tem template; o
-- template tem posição que não é objeto com nome; não há exatamente uma etapa
-- ativa; o nome da ativa não aparece exatamente uma vez no template; alguma
-- linha acima da ativa não é pendente nunca iniciada ou tem aprovação; ou as
-- futuras já batem com o template. Nunca levanta erro: duplicar e continuar
-- precisam funcionar em qualquer fluxo.
--
-- Limite conhecido: as etapas concluídas e a ativa vêm da origem como estão (é
-- histórico, e foi a decisão para 2568/2543). Uma continuação iniciada numa
-- etapa duplicada continua nela, e uma concluída a mais continua como coluna
-- extra até o fluxo terminar.
--
-- Etapas novas não disparam nada: workflow_etapas só tem triggers AFTER UPDATE
-- (notify_step_activated, notify_step_completed, workflow_etapas_updated_event),
-- e o realinhamento só faz DELETE + INSERT de pendentes num fluxo recém-criado.
--
-- As duas RPCs abaixo são cópia VERBATIM das definições mais recentes; só
-- entra o PERFORM depois do INSERT em workflow_etapas. SECURITY DEFINER,
-- search_path e REVOKE/GRANT idênticos.

CREATE OR REPLACE FUNCTION public._realign_pending_etapas_to_template(p_workflow_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tpl    jsonb;
  v_L      int;
  v_n      int;
  v_p      int;
  a        workflow_etapas%ROWTYPE;
  v_tnames text[];
  v_above  text[];
  v_old    jsonb;
  v_used   int[] := '{}';
  v_e      jsonb;
  v_match  jsonb;
  v_i      int;
  v_k      int;
BEGIN
  SELECT t.etapas INTO v_tpl
    FROM workflows w
    JOIN workflow_templates t ON t.id = w.template_id AND t.conta_id = w.conta_id
   WHERE w.id = p_workflow_id;
  IF v_tpl IS NULL OR jsonb_typeof(v_tpl) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_tpl) x(e)
                 WHERE jsonb_typeof(e) <> 'object'
                    OR jsonb_typeof(e -> 'nome') IS DISTINCT FROM 'string') THEN
    RETURN false;
  END IF;
  v_L := jsonb_array_length(v_tpl);

  SELECT count(*) INTO v_n FROM workflow_etapas
   WHERE workflow_id = p_workflow_id AND status = 'ativo';
  IF v_n <> 1 THEN
    RETURN false;
  END IF;
  SELECT * INTO a FROM workflow_etapas
   WHERE workflow_id = p_workflow_id AND status = 'ativo';

  v_tnames := ARRAY(SELECT public.trim_etapa_nome(x.e ->> 'nome')
                      FROM jsonb_array_elements(v_tpl) WITH ORDINALITY x(e, o)
                     ORDER BY x.o);
  SELECT count(*), min(u.o) - 1 INTO v_n, v_p
    FROM unnest(v_tnames) WITH ORDINALITY u(n, o)
   WHERE u.n = public.trim_etapa_nome(a.nome);
  IF v_n <> 1 THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM workflow_etapas z
              WHERE z.workflow_id = p_workflow_id AND z.ordem = a.ordem AND z.id <> a.id)
     OR EXISTS (SELECT 1 FROM workflow_etapas z
                 WHERE z.workflow_id = p_workflow_id AND z.ordem > a.ordem
                   AND (z.status <> 'pendente' OR z.iniciado_em IS NOT NULL
                        OR z.concluido_em IS NOT NULL
                        OR EXISTS (SELECT 1 FROM portal_approvals pa
                                    WHERE pa.workflow_etapa_id = z.id))) THEN
    RETURN false;
  END IF;

  v_above := ARRAY(SELECT public.trim_etapa_nome(z.nome) FROM workflow_etapas z
                    WHERE z.workflow_id = p_workflow_id AND z.ordem > a.ordem
                    ORDER BY z.ordem, z.id);
  IF v_above = v_tnames[v_p + 2 : v_L] THEN
    RETURN false;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.ordem, z.id), '[]'::jsonb) INTO v_old
    FROM workflow_etapas z
   WHERE z.workflow_id = p_workflow_id AND z.ordem > a.ordem;
  DELETE FROM workflow_etapas WHERE workflow_id = p_workflow_id AND ordem > a.ordem;

  FOR v_i IN (v_p + 1) .. (v_L - 1) LOOP
    v_e := v_tpl -> v_i;
    v_match := NULL;
    FOR v_k IN 0 .. jsonb_array_length(v_old) - 1 LOOP
      IF public.trim_etapa_nome(v_old -> v_k ->> 'nome') = public.trim_etapa_nome(v_e ->> 'nome')
         AND NOT (v_k = ANY (v_used)) THEN
        v_match := v_old -> v_k;
        v_used := v_used || v_k;
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
       status, iniciado_em, concluido_em, data_limite)
    VALUES
      (p_workflow_id, a.ordem + (v_i - v_p), v_e ->> 'nome',
       CASE WHEN v_match IS NOT NULL THEN (v_match ->> 'prazo_dias')::integer
            ELSE (v_e ->> 'prazo_dias')::integer END,
       CASE WHEN v_match IS NOT NULL THEN v_match ->> 'tipo_prazo'
            ELSE coalesce(v_e ->> 'tipo_prazo', 'corridos') END,
       CASE WHEN v_match IS NOT NULL THEN (v_match ->> 'responsavel_id')::bigint
            ELSE NULLIF(v_e ->> 'responsavel_id', '')::bigint END,
       CASE WHEN v_match IS NOT NULL THEN v_match ->> 'tipo'
            ELSE coalesce(v_e ->> 'tipo', 'padrao') END,
       'pendente', NULL, NULL,
       (v_match ->> 'data_limite')::date);
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._realign_pending_etapas_to_template(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._realign_pending_etapas_to_template(bigint)
  TO service_role;

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
  UPDATE workflows SET position = position + 1
   WHERE conta_id = v_conta AND position > w.position;
  UPDATE post_processes SET board_position = board_position + 1
   WHERE conta_id = v_conta AND estado IN ('ativo', 'concluido')
     AND board_position > w.position;

  INSERT INTO workflows (
    user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
    recorrente, position, modo_prazo, link_notion, link_drive, concluido_em,
    created_via, plataformas)
  VALUES (
    auth.uid(), v_conta, w.cliente_id, w.titulo || ' (cópia)', w.template_id,
    w.status, w.etapa_atual, w.recorrente,
    w.position + 1,
    w.modo_prazo, w.link_notion, w.link_drive, w.concluido_em, 'human',
    w.plataformas)
  RETURNING id INTO v_new;

  INSERT INTO workflow_etapas (
    workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
    status, iniciado_em, concluido_em, data_limite)
  SELECT v_new, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo, e.responsavel_id,
         e.tipo, e.status, e.iniciado_em, e.concluido_em, e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = w.id
   ORDER BY e.ordem, e.id;

  -- Futuras pelo template (20261021120000): origem com etapas duplicadas nao
  -- passa o defeito para a copia.
  PERFORM public._realign_pending_etapas_to_template(v_new);

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

CREATE OR REPLACE FUNCTION public.move_posts_to_new_flow(
  p_post_ids            bigint[],
  p_source_workflow_id  bigint,
  p_titulo              text,
  p_start_ordem         integer,
  p_archive_empty_flow  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta       uuid := public.get_my_conta_id();
  v_ids         bigint[];
  v_requested   int;
  v_source      bigint;
  v_src         record;
  v_limit       bigint;
  v_new_wf      bigint;
  v_moved       int;
  v_archived    bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  IF p_titulo IS NULL OR btrim(p_titulo) = '' THEN
    RAISE EXCEPTION 'titulo_required' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory locks por conta, na ordem documentada no topo do
  -- arquivo, ANTES de qualquer lock de linha.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_active_workflows_per_client'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  -- Todo post do lote precisa estar no fluxo DECLARADO (leitura sem lock --
  -- os locks de linha vem depois, workflow antes de posts, e o lote e
  -- re-validado ja travado).
  v_source := public.move_posts_source_of_batch(v_conta, v_ids);
  IF v_source <> p_source_workflow_id THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Trava a origem e captura o que o fluxo novo herda.
  SELECT w.cliente_id, w.template_id, w.modo_prazo, w.user_id, w.plataformas
    INTO v_src
    FROM workflows w
   WHERE w.id = v_source AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2) A etapa inicial pedida precisa existir na origem.
  PERFORM 1
    FROM workflow_etapas e
   WHERE e.workflow_id = v_source AND e.ordem = p_start_ordem;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_start_etapa' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Trava os posts em ordem estavel e re-valida o lote ja travado. Um
  -- lote que mudou de fluxo no meio (teorico sob ':post_move') ou encolheu
  -- (DELETE concorrente) cai num erro limpo aqui.
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;
  IF public.move_posts_source_of_batch(v_conta, v_ids) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 4) Limite de posts do fluxo destino (que nasce vazio): o trigger
  -- trg_limit_posts so roda em INSERT e nunca dispara neste UPDATE, entao a
  -- guarda manual e o unico enforcement -- mesma fronteira do attach
  -- (= limite passa; limite + 1 estoura).
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL AND v_requested > v_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
  END IF;

  -- 5) Fluxo novo. trg_limit_workflows (BEFORE INSERT, status ativo) valida
  -- max_active_workflows_per_client sozinho e ja levanta o erro no formato
  -- plan_limit_exceeded:* -- o advisory correspondente foi tomado no PASSO 0.
  -- auth.uid() e o criador real; o fallback para o dono da origem cobre
  -- chamadas service_role sem usuario.
  INSERT INTO workflows
    (user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
     recorrente, modo_prazo, created_via, plataformas)
  VALUES
    (coalesce(auth.uid(), v_src.user_id), v_conta, v_src.cliente_id,
     btrim(p_titulo), v_src.template_id, 'ativo', p_start_ordem,
     false, v_src.modo_prazo, 'human', v_src.plataformas)
  RETURNING id INTO v_new_wf;

  INSERT INTO workflow_etapas
    (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
     status, iniciado_em, concluido_em, data_limite)
  SELECT v_new_wf, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo,
         e.responsavel_id, e.tipo,
         CASE WHEN e.ordem < p_start_ordem THEN 'concluido'
              WHEN e.ordem = p_start_ordem THEN 'ativo'
              ELSE 'pendente' END,
         CASE WHEN e.ordem < p_start_ordem THEN coalesce(e.iniciado_em, now())
              WHEN e.ordem = p_start_ordem THEN now()
              ELSE NULL END,
         CASE WHEN e.ordem < p_start_ordem THEN coalesce(e.concluido_em, now())
              ELSE NULL END,
         e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = v_source;

  -- Futuras pelo template (20261021120000): origem com etapas duplicadas nao
  -- passa o defeito para o fluxo novo. Antes do RETURN, que devolve as etapas.
  PERFORM public._realign_pending_etapas_to_template(v_new_wf);

  -- 6) Opcoes extras por fluxo + move em si.
  PERFORM public.remap_moved_posts_select_options(
    v_conta, v_ids, v_source, v_new_wf, v_src.template_id, true);
  v_moved := public.move_posts_core(v_conta, v_ids, v_new_wf, -1);

  -- 7) Arquiva a origem se este exato lote a esvaziou (mesma semantica do
  -- detach; a linha ja esta travada desde o passo 1). O Trigger B de
  -- workflow_events grava 'fluxo_arquivado' normalmente.
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = v_source) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = v_source;
    v_archived := ARRAY[v_source];
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'target_workflow_id', v_new_wf,
    'archived_workflow_ids', to_jsonb(v_archived),
    'workflow', (SELECT to_jsonb(w) FROM workflows w WHERE w.id = v_new_wf),
    'etapas', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ordem), '[]'::jsonb)
                 FROM workflow_etapas e WHERE e.workflow_id = v_new_wf)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_posts_to_new_flow(bigint[], bigint, text, integer, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_posts_to_new_flow(bigint[], bigint, text, integer, boolean)
  TO authenticated, service_role;
