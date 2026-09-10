-- supabase/migrations/20260919000003_detach_posts_keeping_process.sql
-- Desmembrar do fluxo mantendo as etapas (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secoes 5.1, 7, 9.4, 9.5).
--
-- Estende a familia detach/attach/move (20260830000004, 20260901110000):
-- mesmo estilo de erro, mesmos REVOKE/GRANT, mesmo padrao
-- "PERFORM ... FOR UPDATE" seguido de agregacao numa instrucao separada.
--
-- ORDEM DE LOCKS. Advisory ':post_move' no TOPO, antes de qualquer lock de
-- linha. Isso e obrigatorio e nao so higiene: a FK composta
-- post_processes_origem_same_tenant pega FOR KEY SHARE em workflows quando o
-- processo e inserido com origem_workflow_id, e isso fecha ciclo com o FOR
-- UPDATE que attach_posts_to_flow segura na linha do fluxo alvo. Com o
-- advisory, as duas RPCs nunca interleiam na mesma conta. Locks de linha
-- depois, sempre fluxo -> post -> processo.
--
-- IDEMPOTENCIA. p_request_id e consultado DEPOIS do advisory: duas chamadas
-- simultaneas com o mesmo id serializam no advisory, a segunda encontra o
-- recibo e devolve o resultado guardado sem repetir efeito. O evento por post
-- nao carrega o id da requisicao (spec 8.1); o recibo e a unica trilha.
--
-- DIGEST DAS ENTRADAS. O recibo nao guarda so o resultado: guarda tambem
-- 'input_hash', o md5 de p_workflow_id, dos ids do lote ja deduplicados e
-- ORDENADOS, de p_fingerprint e de p_archive_empty_flow. Sem ele, reusar um
-- request_id com outro lote devolveria o resultado do lote antigo com
-- 'ok': true e o CRM daria por feito um desmembrar que nunca aconteceu. Com
-- ele, entrada divergente responde request_mismatch. p_archive_empty_flow
-- entra no digest por ser ESCOLHA do usuario (o checkbox do dialogo): a mesma
-- selecao com ele marcado e outro comando, nao a mesma requisicao repetida.
-- Os dois prazos ficam de fora pelo motivo oposto, ver PRAZOS abaixo. A chave
-- e adicionada ao gravar e removida ao devolver, de modo que o formato de
-- retorno da secao Interfaces nao muda.
--
-- PRAZOS. Quem calcula prazo efetivo e o CRM (computeDeadlineDate), com o fuso
-- do navegador; a RPC so armazena. p_active_deadline e o prazo congelado da
-- etapa ativa da origem, obrigatorio. p_step_deadlines e o mapa
-- {"<ordem>": "<ISO>"} das etapas POSTERIORES a ativa que tinham data fixa na
-- origem: post_process_steps nao tem coluna data_limite, entao sem esse mapa a
-- data fixa de uma etapa futura se perderia no snapshot. Etapa futura sem
-- entrada no mapa fica com prazo_efetivo nulo e recebe prazo quando for
-- ativada por transition_post_process.

CREATE OR REPLACE FUNCTION public.detach_posts_keeping_process(
  p_post_ids            bigint[],
  p_workflow_id         bigint,
  p_fingerprint         text,
  p_active_deadline     timestamptz,
  p_request_id          uuid,
  p_step_deadlines      jsonb   DEFAULT NULL,
  p_archive_empty_flow  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta       uuid := public.post_process_require_editor();
  v_ids         bigint[];
  v_requested   int;
  v_hash        text;
  v_owned       int;
  v_fora        int;
  v_prev        jsonb;
  v_wf          record;
  v_ativa       record;
  v_n_ativas    int;
  v_assinatura  text;
  v_tmpl_nome   text;
  v_board       integer;
  v_key         text;
  v_val         text;
  v_post_id     bigint;
  v_proc        bigint;
  v_proc_ids    bigint[] := '{}';
  v_detached    int;
  v_archived    bigint[] := '{}';
  v_processes   jsonb;
  v_steps       jsonb;
  v_res         jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_active_deadline IS NULL THEN
    RAISE EXCEPTION 'active_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_ids
    FROM unnest(p_post_ids) x WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- Digest canonico das entradas que identificam o lote e o comando. v_ids ja
  -- esta deduplicado e ordenado, entao a mesma chamada em outra ordem de ids
  -- da o mesmo hash. p_archive_empty_flow entra por ser escolha do usuario.
  v_hash := md5(coalesce(p_workflow_id::text, '') || '|' ||
                array_to_string(v_ids, ',') || '|' ||
                coalesce(p_fingerprint, '') || '|' ||
                coalesce(p_archive_empty_flow::text, 'false'));

  -- PASSO 0: advisory por conta, antes de tudo.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- PASSO 1: recibo de idempotencia.
  SELECT r.resultado INTO v_prev
    FROM post_process_batch_requests r
   WHERE r.request_id = p_request_id AND r.conta_id = v_conta;
  IF FOUND THEN
    IF v_prev ->> 'input_hash' IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'request_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_prev - 'input_hash';
  END IF;
  -- request_id e PK global: existir sem casar a conta e recibo alheio.
  IF EXISTS (SELECT 1 FROM post_process_batch_requests r WHERE r.request_id = p_request_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 2: fluxo de origem travado.
  SELECT w.id, w.titulo, w.status, w.template_id, w.modo_prazo
    INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wf.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 3: fingerprint recalculado sob lock.
  IF public.workflow_fingerprint(p_workflow_id) IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'workflow_changed' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 4: exatamente uma etapa ativa.
  SELECT count(*) INTO v_n_ativas FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';
  IF v_n_ativas <> 1 THEN
    RAISE EXCEPTION 'workflow_etapas_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  SELECT e.ordem, e.nome INTO v_ativa FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';

  -- PASSO 5: mapa de prazos de etapas futuras.
  IF p_step_deadlines IS NOT NULL THEN
    IF jsonb_typeof(p_step_deadlines) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(p_step_deadlines) LOOP
      IF v_key !~ '^[0-9]+$' OR v_key::integer <= v_ativa.ordem THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM workflow_etapas e
                      WHERE e.workflow_id = p_workflow_id AND e.ordem = v_key::integer) THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        PERFORM v_val::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END;
    END LOOP;
  END IF;

  -- PASSO 6: posts travados em ordem estavel, all-or-nothing.
  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  SELECT count(*) INTO v_owned FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;
  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_fora FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
     AND wp.workflow_id IS DISTINCT FROM p_workflow_id;
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 7: snapshot compartilhado (assinatura, nome do template, base do board).
  SELECT string_agg(e.ordem::text || '|' || e.nome || '|' || coalesce(nullif(e.tipo, ''), 'padrao'),
                    chr(10) ORDER BY e.ordem)
    INTO v_assinatura
    FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  SELECT t.nome INTO v_tmpl_nome FROM workflow_templates t
   WHERE t.id = v_wf.template_id AND t.conta_id = v_conta;

  -- Base do board: max entre os processos que APARECEM no quadro, ativos e
  -- concluidos. So os ativos deixaria um concluido reaberto colidindo com um
  -- processo novo na mesma posicao (Decisao 19). Encerrado nao aparece.
  SELECT coalesce(max(pp.board_position), -1) INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  -- PASSO 8: desvincular. O GUC e transacional e volta a 'off' logo depois,
  -- para nao deixar post_a0_sync_cliente aberto no resto da transacao. O
  -- trigger post_a1_process_guard nao dispara aqui: o UPDATE zera workflow_id.
  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts SET workflow_id = NULL
   WHERE id = ANY(v_ids) AND conta_id = v_conta;
  GET DIAGNOSTICS v_detached = ROW_COUNT;
  PERFORM set_config('app.allow_post_move', 'off', true);

  -- PASSO 9: um processo por post, com as etapas em snapshot e o evento.
  FOREACH v_post_id IN ARRAY v_ids LOOP
    v_board := v_board + 1;
    INSERT INTO post_processes
      (conta_id, post_id, template_id, template_nome, assinatura, origem_workflow_id,
       origem_descricao, estado, etapa_atual, modo_prazo, board_position, created_by)
    VALUES
      (v_conta, v_post_id, v_wf.template_id, v_tmpl_nome, v_assinatura, p_workflow_id,
       v_wf.titulo || ', etapa ' || v_ativa.nome, 'ativo', v_ativa.ordem,
       coalesce(v_wf.modo_prazo, 'padrao'), v_board, auth.uid())
    RETURNING id INTO v_proc;
    v_proc_ids := v_proc_ids || v_proc;

    INSERT INTO post_process_steps
      (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
       prazo_efetivo, estado, iniciado_em, origem_etapa_ordem, origem_etapa_nome)
    SELECT
      v_conta, v_proc, e.ordem, e.nome, coalesce(nullif(e.tipo, ''), 'padrao'),
      -- Decisao 17 tambem aqui: workflow_etapas.responsavel_id e FK simples
      -- para membros(id), sem tenant. post_process_steps.responsavel_id tem FK
      -- composta com conta_id, entao um valor cross-tenant derrubaria o lote
      -- inteiro com foreign_key_violation cru, sem codigo. Nao resolve, vira
      -- nulo, e a UI mostra "Sem responsavel".
      (SELECT m.id FROM membros m WHERE m.id = e.responsavel_id AND m.conta_id = v_conta),
      e.prazo_dias, e.tipo_prazo,
      CASE WHEN e.ordem = v_ativa.ordem THEN p_active_deadline
           WHEN e.ordem > v_ativa.ordem
             THEN (p_step_deadlines ->> e.ordem::text)::timestamptz
           ELSE NULL END,
      CASE WHEN e.ordem < v_ativa.ordem THEN 'herdado'
           WHEN e.ordem = v_ativa.ordem THEN 'ativo'
           ELSE 'pendente' END,
      CASE WHEN e.ordem = v_ativa.ordem THEN now() ELSE NULL END,
      e.ordem, e.nome
      FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id;

    PERFORM public.post_process_log_event(
      v_conta, v_post_id, v_proc, 'desmembrado',
      jsonb_build_object('workflow_id', p_workflow_id, 'workflow_titulo', v_wf.titulo,
                         'etapa_ordem', v_ativa.ordem, 'etapa_nome', v_ativa.nome),
      jsonb_build_object('process_id', v_proc, 'etapa_atual', v_ativa.ordem,
                         'prazo_efetivo', p_active_deadline));
  END LOOP;

  -- PASSO 10: arquivar a origem se este lote a esvaziou. A linha ja esta
  -- travada desde o passo 2; a ressalva contra INSERT concorrente e a mesma de
  -- detach_posts_from_flow (o FOR SHARE do trigger na linha do fluxo).
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = p_workflow_id) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = p_workflow_id;
    v_archived := ARRAY[p_workflow_id];
  END IF;

  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.post_id) INTO v_processes FROM (
    SELECT pp.id AS process_id, pp.post_id, pp.etapa_atual, pp.revisao, pp.board_position,
           pp.assinatura, pp.origem_workflow_id, pp.origem_descricao
      FROM post_processes pp WHERE pp.id = ANY(v_proc_ids)) x;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.process_id, y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = ANY(v_proc_ids)) y;

  v_res := jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'detached', v_detached,
    'archived_workflow_ids', to_jsonb(v_archived),
    'processes', coalesce(v_processes, '[]'::jsonb),
    'steps', coalesce(v_steps, '[]'::jsonb));

  INSERT INTO post_process_batch_requests (request_id, conta_id, resultado)
  VALUES (p_request_id, v_conta, v_res || jsonb_build_object('input_hash', v_hash));

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.detach_posts_keeping_process(bigint[], bigint, text, timestamptz, uuid, jsonb, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.detach_posts_keeping_process(bigint[], bigint, text, timestamptz, uuid, jsonb, boolean)
  TO authenticated, service_role;
