-- Mover posts entre fluxos: RPCs move_posts_to_new_flow / move_posts_to_existing_flow.
-- Spec: docs/superpowers/specs/2026-09-01-mover-posts-entre-fluxos-design.md.
--
-- Depende da 20260830000001 (workflow_posts.cliente_id + guard
-- post_move_requires_rpc via GUC transacional app.allow_post_move), da
-- 20260830000003 (folder_sync_post reparenta a pasta do post sozinho quando
-- workflow_id muda -- nenhuma logica de pasta aqui) e da 20260830000004
-- (detach/attach -- a familia de RPCs e de advisory locks que estas duas
-- funcoes estendem; estilo de erro, REVOKE/GRANT e padrao
-- "PERFORM ... FOR UPDATE" copiados de la).
--
-- Posts nao tem etapa propria: a posicao no funil e do fluxo. Avancar um
-- subconjunto de posts separadamente = move-los para outro fluxo -- um NOVO
-- (clone das etapas da origem, comecando na etapa escolhida) ou um EXISTENTE
-- do mesmo cliente e MESMO template. Sem passar por avulso no meio (o caminho
-- detach->attach continua existindo para fluxos de template diferente).
--
-- A origem e um parametro EXPLICITO (p_source_workflow_id), nao derivada do
-- lote (achado de review externa): sem ela, uma selecao obsoleta cujos posts
-- migraram TODOS para outro fluxo unico entre o render e o confirm passaria
-- na checagem de "fluxo unico" e clonaria etapas/arquivaria o fluxo ERRADO.
-- Todo post do lote precisa estar no fluxo declarado (post_not_in_source_flow,
-- all-or-nothing), checado na descoberta E re-checado com as linhas travadas.
--
-- Advisory locks -- ordem fixa nas DUAS RPCs, ANTES de qualquer lock de linha:
--
--   1) ':post_move' -- mesma chave de detach/attach (20260830000004, item 1 do
--      header de la): serializa toda a familia de movimentacao por conta, entao
--      os locks de linha de uma RPC nunca interleiam com os de outra.
--
--   2) ':max_active_workflows_per_client' -- SO em move_posts_to_new_flow, e
--      obrigatoriamente ANTES de ':max_posts_per_workflow'. Motivo (AB/BA):
--      uma transacao comum que insere um workflow e depois um post toma, via
--      enforce_plan_count_limit (20260611130002) nos triggers
--      trg_limit_workflows -> trg_limit_posts, primeiro a chave de max_active
--      e depois a de max_posts. Se esta RPC tomasse max_posts antes de
--      max_active, as duas ordens formariam espera circular (40P01). Tomar
--      max_active aqui em cima tambem e o que mantem o invariante "todo
--      advisory antes de todo lock de linha": sem isso o INSERT em workflows
--      la embaixo tomaria essa chave (via trigger) com linhas ja travadas.
--      pg_advisory_xact_lock e reentrante, entao o trigger re-tomar a chave e
--      gratis. move_posts_to_existing_flow nao insere workflow e nao toma esta
--      chave -- sem inversao dentro da familia, que ja se serializa por
--      ':post_move'.
--
--   3) ':max_posts_per_workflow' -- mesmo motivo do fix round 2 do attach
--      (20260830000004, item 2): antes de qualquer lock de linha de workflow,
--      senao um INSERT concorrente em workflow_posts (trg_limit_posts + FOR
--      KEY SHARE da FK) forma ciclo contra o FOR UPDATE da RPC.
--
--   Caso residual aceito (identico ao de detach/attach): deadlock teorico
--   contra propagate_workflow_cliente_to_posts -- raro, autorrecuperavel
--   (40P01) e o store do CRM retenta uma vez.
--
-- workflow_select_options.option_id e UNIQUE GLOBAL (20260403), entao "copiar"
-- uma opcao extra por fluxo preservando o id e impossivel: o helper de remap
-- faz find-or-create por (property_definition_id, label) no destino e REMAPEIA
-- os valores dos posts movidos (select e status guardam um option_id escalar;
-- multiselect um array jsonb de option_ids). As opcoes BASE moram em
-- template_property_definitions.config.options, com ids estaveis entre fluxos
-- do mesmo template -- essas resolvem sozinhas no destino e nunca passam pelo
-- helper. As linhas da origem ficam intactas (posts que permanecem la
-- continuam resolvendo).
--
-- Isolamento de tenant no helper de remap: as FKs de workflow_select_options
-- sao globais e a RLS da tabela valida apenas conta_id -- uma linha forjada
-- pode apontar workflow_id/property_definition_id de outra conta. Como tudo
-- aqui roda SECURITY DEFINER, o helper exige wso.conta_id = conta chamadora E
-- join com template_property_definitions da mesma conta e do template da
-- origem; os UPDATEs de post_property_values ficam limitados aos post_ids ja
-- validados do lote.

-- ============================================================
-- Helper privado: resolve o fluxo de origem de um lote de posts.
-- Uma unica leitura agregada produz os tres erros em ordem deterministica:
-- post_not_found (all-or-nothing de posse, mesma contagem do detach),
-- post_not_in_flow (avulso no lote), posts_in_multiple_flows. Chamado duas
-- vezes pelas RPCs: antes dos locks (descoberta) e depois (re-validacao do
-- lote ja travado -- sob ':post_move' a janela e teorica, mas um DELETE
-- concorrente ainda pode encolher o lote, e a re-checagem vira erro limpo).
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_posts_source_of_batch(
  p_conta     uuid,
  p_post_ids  bigint[]
) RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested  int := array_length(p_post_ids, 1);
  v_owned      int;
  v_no_flow    int;
  v_sources    bigint[];
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE wp.workflow_id IS NULL),
         array_agg(DISTINCT wp.workflow_id) FILTER (WHERE wp.workflow_id IS NOT NULL)
    INTO v_owned, v_no_flow, v_sources
    FROM workflow_posts wp
   WHERE wp.id = ANY(p_post_ids) AND wp.conta_id = p_conta;

  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_no_flow > 0 THEN
    RAISE EXCEPTION 'post_not_in_flow' USING ERRCODE = 'P0001';
  END IF;
  IF array_length(v_sources, 1) <> 1 THEN
    RAISE EXCEPTION 'posts_in_multiple_flows' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_sources[1];
END;
$$;

REVOKE ALL ON FUNCTION public.move_posts_source_of_batch(uuid, bigint[])
  FROM public, anon, authenticated;

-- ============================================================
-- Helper privado: remap de opcoes extras por fluxo (ver nota no topo).
-- p_copy_all = true (novo fluxo): toda opcao extra da origem e materializada
-- no destino, referenciada ou nao -- o fluxo novo deve oferecer o mesmo
-- cardapio de opcoes que a origem oferecia. false (fluxo existente): so as
-- opcoes efetivamente usadas pelos posts movidos sao find-or-create'adas.
-- Empate de label no destino resolve para a linha de menor id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remap_moved_posts_select_options(
  p_conta               uuid,
  p_post_ids            bigint[],
  p_source_workflow_id  bigint,
  p_target_workflow_id  bigint,
  p_template_id         bigint,
  p_copy_all            boolean
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row         record;
  v_new_option  uuid;
BEGIN
  -- Sem template nao ha property definitions, logo nao ha opcoes nem valores
  -- a remapear (o join abaixo nunca casaria com tpd.template_id = NULL).
  IF p_template_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT wso.property_definition_id, wso.option_id, wso.label, wso.color
      FROM workflow_select_options wso
      JOIN template_property_definitions tpd
        ON tpd.id = wso.property_definition_id
       AND tpd.conta_id = p_conta
       AND tpd.template_id = p_template_id
     WHERE wso.workflow_id = p_source_workflow_id
       AND wso.conta_id = p_conta
     ORDER BY wso.id
  LOOP
    IF NOT p_copy_all THEN
      PERFORM 1
        FROM post_property_values ppv
       WHERE ppv.post_id = ANY(p_post_ids)
         AND ppv.property_definition_id = v_row.property_definition_id
         AND (ppv.value = to_jsonb(v_row.option_id::text)
              OR (jsonb_typeof(ppv.value) = 'array'
                  AND ppv.value ? v_row.option_id::text));
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT wso.option_id INTO v_new_option
      FROM workflow_select_options wso
     WHERE wso.workflow_id = p_target_workflow_id
       AND wso.conta_id = p_conta
       AND wso.property_definition_id = v_row.property_definition_id
       AND wso.label = v_row.label
     ORDER BY wso.id
     LIMIT 1;

    IF v_new_option IS NULL THEN
      INSERT INTO workflow_select_options
        (workflow_id, property_definition_id, conta_id, label, color)
      VALUES
        (p_target_workflow_id, v_row.property_definition_id, p_conta,
         v_row.label, v_row.color)
      RETURNING option_id INTO v_new_option;
    END IF;

    UPDATE post_property_values ppv
       SET value = CASE
         WHEN ppv.value = to_jsonb(v_row.option_id::text)
           THEN to_jsonb(v_new_option::text)
         ELSE (SELECT jsonb_agg(CASE WHEN e = to_jsonb(v_row.option_id::text)
                                     THEN to_jsonb(v_new_option::text)
                                     ELSE e END)
                 FROM jsonb_array_elements(ppv.value) e)
       END
     WHERE ppv.post_id = ANY(p_post_ids)
       AND ppv.property_definition_id = v_row.property_definition_id
       AND (ppv.value = to_jsonb(v_row.option_id::text)
            OR (jsonb_typeof(ppv.value) = 'array'
                AND ppv.value ? v_row.option_id::text));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.remap_moved_posts_select_options(uuid, bigint[], bigint, bigint, bigint, boolean)
  FROM public, anon, authenticated;

-- ============================================================
-- Helper privado: o move em si. GUC transacional (reseta no COMMIT/ROLLBACK,
-- nunca vaza) libera o guard post_move_requires_rpc; ordem renumerada
-- preservando a ordem RELATIVA que o usuario via na origem (ORDER BY ordem, id
-- -- melhoria deliberada sobre o ORDER BY id puro do attach, que so lida com
-- avulsos sem ordem visivel). cliente_id nao muda (mesmo cliente, ja
-- validado); board_ordem e workflow-agnostico e fica intocado;
-- folder_sync_post reparenta a pasta sozinho.
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_posts_core(
  p_conta               uuid,
  p_post_ids            bigint[],
  p_target_workflow_id  bigint,
  p_base_ordem          integer
) RETURNS int
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_moved int;
BEGIN
  PERFORM set_config('app.allow_post_move', 'on', true);

  WITH ranked AS (
    SELECT wp.id, row_number() OVER (ORDER BY wp.ordem, wp.id) AS rn
      FROM workflow_posts wp
     WHERE wp.id = ANY(p_post_ids) AND wp.conta_id = p_conta
  )
  UPDATE workflow_posts wp
     SET workflow_id = p_target_workflow_id,
         ordem = (p_base_ordem + ranked.rn)::integer
    FROM ranked
   WHERE wp.id = ranked.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.move_posts_core(uuid, bigint[], bigint, integer)
  FROM public, anon, authenticated;

-- ============================================================
-- move_posts_to_new_flow: cria um fluxo novo a partir da origem e move o lote
-- para ele. O fluxo novo herda cliente/template/modo_prazo e nasce com as
-- etapas da origem clonadas na matriz:
--   ordem < p_start_ordem  -> concluido (iniciado_em/concluido_em =
--                             coalesce(original, now()) -- uma etapa ainda nao
--                             iniciada na origem vira concluida no clone e
--                             precisa de timestamps nao nulos);
--   ordem = p_start_ordem  -> ativo (iniciado_em = now(), concluido_em NULL);
--   ordem > p_start_ordem  -> pendente (ambos NULL -- nada herdado: uma etapa
--                             "rebaixada" nao pode carregar timestamps de
--                             quando estava ativa/concluida na origem).
-- data_limite copiado como esta em todos os modos: o fluxo novo esta no MESMO
-- ponto do calendario que a origem (duplicateWorkflow recalcula porque clona
-- para o PROXIMO ciclo -- caso diferente). Etapas ja inseridas com status
-- final: nenhum trigger de evento/notificacao de etapa dispara (mesmo
-- comportamento da criacao normal); o evento 'criado' do fluxo sai sozinho do
-- Trigger A de workflow_events. recorrente = false: o split e uma continuacao
-- one-off -- se herdasse a recorrencia, o ciclo seguinte duplicaria origem E
-- clone. created_via = 'human' (CHECK so admite human/agent).
-- ============================================================
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
    'archived_workflow_ids', to_jsonb(v_archived)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_posts_to_new_flow(bigint[], bigint, text, integer, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_posts_to_new_flow(bigint[], bigint, text, integer, boolean)
  TO authenticated, service_role;

-- ============================================================
-- move_posts_to_existing_flow: move o lote direto para um fluxo ativo do
-- mesmo cliente e MESMO template da origem (sem passar por avulso). Nao ha
-- escolha de etapa: o destino esta onde esta. A restricao de template e
-- deliberadamente mais estrita que a do attach (que aceita qualquer fluxo
-- ativo do cliente): origem com template_id NULL tambem falha -- NULL-NULL
-- nao e "mesmo modelo".
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_posts_to_existing_flow(
  p_post_ids            bigint[],
  p_source_workflow_id  bigint,
  p_target_workflow_id  bigint,
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
  v_tgt         record;
  v_limit       bigint;
  v_current     bigint;
  v_base_ordem  integer;
  v_moved       int;
  v_archived    bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  IF p_target_workflow_id = p_source_workflow_id THEN
    RAISE EXCEPTION 'target_is_source' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory locks (ordem documentada no topo; este caminho nao
  -- insere workflow e por isso nao toma ':max_active_workflows_per_client').
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  -- Todo post do lote precisa estar no fluxo DECLARADO (mesmo contrato do
  -- new-flow: descoberta sem lock + re-checagem travada mais abaixo).
  v_source := public.move_posts_source_of_batch(v_conta, v_ids);
  IF v_source <> p_source_workflow_id THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Trava origem E destino numa unica passada em ordem estavel de id
  -- (higiene de ordem entre duas chamadas com origem/destino invertidos --
  -- ':post_move' ja as serializa, mas a ordem estavel nao custa nada).
  PERFORM 1
    FROM workflows w
   WHERE w.id IN (v_source, p_target_workflow_id) AND w.conta_id = v_conta
   ORDER BY w.id
     FOR UPDATE;

  SELECT w.cliente_id, w.template_id INTO v_src
    FROM workflows w
   WHERE w.id = v_source AND w.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT w.cliente_id, w.template_id, w.status INTO v_tgt
    FROM workflows w
   WHERE w.id = p_target_workflow_id AND w.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_tgt.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_tgt.cliente_id <> v_src.cliente_id THEN
    RAISE EXCEPTION 'workflow_different_client' USING ERRCODE = 'P0001';
  END IF;
  IF v_src.template_id IS NULL
     OR v_tgt.template_id IS DISTINCT FROM v_src.template_id THEN
    RAISE EXCEPTION 'workflow_template_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- 2) Trava os posts e re-valida o lote (mesma logica do new-flow).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;
  IF public.move_posts_source_of_batch(v_conta, v_ids) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Limite de posts do destino (guarda manual; advisory ja tomado).
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current
      FROM workflow_posts
     WHERE workflow_id = p_target_workflow_id AND conta_id = v_conta;
    IF v_current + v_requested > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4) Opcoes extras + move (append apos o max(ordem) atual do destino,
  -- mesma base do attach; lock e leitura agregada em instrucoes separadas,
  -- padrao reorder_post_schedules).
  PERFORM public.remap_moved_posts_select_options(
    v_conta, v_ids, v_source, p_target_workflow_id, v_src.template_id, false);

  SELECT coalesce(max(ordem), -1) INTO v_base_ordem
    FROM workflow_posts
   WHERE workflow_id = p_target_workflow_id AND conta_id = v_conta;

  v_moved := public.move_posts_core(v_conta, v_ids, p_target_workflow_id, v_base_ordem);

  -- 5) Arquiva a origem se este exato lote a esvaziou (linha ja travada).
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = v_source) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = v_source;
    v_archived := ARRAY[v_source];
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'target_workflow_id', p_target_workflow_id,
    'archived_workflow_ids', to_jsonb(v_archived)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_posts_to_existing_flow(bigint[], bigint, bigint, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_posts_to_existing_flow(bigint[], bigint, bigint, boolean)
  TO authenticated, service_role;
