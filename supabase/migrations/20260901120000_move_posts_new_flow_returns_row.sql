-- Retorno enriquecido de move_posts_to_new_flow: alem de target_workflow_id,
-- devolve a LINHA do workflow recem-criado ('workflow') e suas etapas clonadas
-- ('etapas', ordenadas por ordem). Motivo (perf, follow-up do PR #424): o
-- fluxo novo so aparece no board depois do refetch de ['workflows'] E do
-- refetch em cascata de ['all-active-etapas'] (cuja chave inclui a lista de
-- ids ativos -- lista nova = cache miss = uma request de etapas POR fluxo
-- ativo). Com a linha e as etapas no retorno, o CRM monta um card provisorio
-- e abre o drawer do destino imediatamente, deixando a cascata acontecer em
-- segundo plano. Mudanca aditiva: chamadores antigos ignoram as chaves novas;
-- o frontend trata 'workflow'/'etapas' como opcionais (fallback = comportamento
-- anterior), entao nao ha ordem obrigatoria de deploy entre este arquivo e o
-- frontend. Corpo identico ao da 20260901110000 fora o RETURN -- validacoes,
-- ordem de advisory locks e comentarios preservados; ver o header daquele
-- arquivo para o racional completo.

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
  SELECT w.cliente_id, w.template_id, w.modo_prazo, w.user_id
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
     recorrente, modo_prazo, created_via)
  VALUES
    (coalesce(auth.uid(), v_src.user_id), v_conta, v_src.cliente_id,
     btrim(p_titulo), v_src.template_id, 'ativo', p_start_ordem,
     false, v_src.modo_prazo, 'human')
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
