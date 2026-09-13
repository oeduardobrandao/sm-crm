-- Ordem manual do quadro de Fluxos com os dois tipos de card
-- (spec secoes 4.2 e 9.1).
--
-- workflows.position e post_processes.board_position vivem no MESMO espaco de
-- indices por coluna. Um drag envia a coluna INTEIRA, ja incluindo os cards que
-- o filtro esconde, e esta RPC grava cada indice no campo do tipo certo, numa
-- transacao. Isso corrige, para os dois tipos, o defeito que o pre-requisito 2
-- corrige so para fluxos (N UPDATEs em paralelo, so sobre os cards visiveis).
--
-- Molde: reorder_workflow_positions (20260917000001, PR #479), que nao esta em
-- main. Esta funcao nao depende dela: reordena fluxos por conta propria. Se as
-- duas coexistirem, cada uma serve um quadro.
--
-- Toma o advisory ':post_move', mesmo sem inserir nem reabrir processo e sem
-- mexer em workflow_id: apply e detach calculam MAX(board_position)+1 sob
-- essa mesma chave (para o processo que eles criam/reabrem), e um reorder
-- concorrente sem o advisory podia gravar a mesma posicao enquanto o calculo
-- de um dos outros dois ainda estava em voo, empatando o espaco de indices.
-- Com o advisory as tres serializam. Ordem de locks continua
-- advisory -> fluxos -> processos.
--
-- Nenhum trigger le position/board_position, e board_position esta fora do
-- UPDATE OF de post_processes_requires_avulso. Nao incrementa revisao: ordenar
-- o quadro nao e mudanca de estado do processo.

CREATE OR REPLACE FUNCTION public.reorder_fluxos_board(
  p_workflow_ids       bigint[],
  p_workflow_positions integer[],
  p_process_ids        bigint[],
  p_process_positions  integer[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.post_process_require_editor();
  v_nw    int  := coalesce(array_length(p_workflow_ids, 1), 0);
  v_np    int  := coalesce(array_length(p_process_ids, 1), 0);
  v_count int;
BEGIN
  IF v_nw IS DISTINCT FROM coalesce(array_length(p_workflow_positions, 1), 0)
     OR v_np IS DISTINCT FROM coalesce(array_length(p_process_positions, 1), 0)
     OR (v_nw = 0 AND v_np = 0) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  -- Duplicatas derrubam a chamada ANTES de qualquer UPDATE. Com o mesmo id
  -- duas vezes num array, o UPDATE ... FROM unnest(...) junta a linha a duas
  -- fontes e o Postgres nao define qual vence: a ordem persistida sairia nao
  -- deterministica. Posicao repetida produz o mesmo sintoma na leitura, e como
  -- workflows.position e post_processes.board_position sao UM espaco de indices
  -- por coluna (secao 4.2), a checagem de posicao e sobre os dois arrays
  -- concatenados. count(DISTINCT) ignora NULL, entao um id ou uma posicao nula
  -- tambem cai aqui, o mesmo codigo que o molde reorder_workflow_positions usa
  -- para comprimento e nulos.
  --
  -- NAO se compara id de fluxo com id de processo: sao tabelas e sequences
  -- diferentes, e uma coluna legitima pode conter o fluxo 5 e o processo 5.
  -- Densidade tambem nao e exigida: a coluna pode ser esparsa (Decisao 19), so
  -- nao pode ter empate.
  IF v_nw > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) IS DISTINCT FROM v_nw THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF v_np > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) IS DISTINCT FROM v_np THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_workflow_positions || p_process_positions) x)
     IS DISTINCT FROM (v_nw + v_np) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  -- Ver cabecalho: apply/detach calculam MAX(board_position)+1 sob esta
  -- mesma chave, entao o reorder precisa serializar com elas para nao empatar.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Fluxo arquivado nao pode ter vindo de um drag, mesmo raciocinio do filtro de estado do processo abaixo.
  IF v_nw > 0 THEN
    PERFORM 1 FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta
       AND w.status IS DISTINCT FROM 'arquivado'
     ORDER BY w.id
       FOR UPDATE;
    SELECT count(DISTINCT w.id) INTO v_count FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta
       AND w.status IS DISTINCT FROM 'arquivado';
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) THEN
      RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Estado restrito a 'ativo' e 'concluido': sao os unicos que viram card no
  -- quadro. Um id de processo 'encerrado' nao pode ter vindo de um drag, entao
  -- gravar board_position nele so poluiria o espaco de indices. Com o filtro,
  -- a RPC fica mais fechada e o erro (process_not_found) fica correto.
  IF v_np > 0 THEN
    PERFORM 1 FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido')
     ORDER BY pp.id
       FOR UPDATE;
    SELECT count(DISTINCT pp.id) INTO v_count FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido');
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) THEN
      RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_nw > 0 THEN
    UPDATE workflows w
       SET position = u.pos
      FROM unnest(p_workflow_ids, p_workflow_positions) AS u(id, pos)
     WHERE w.id = u.id AND w.conta_id = v_conta;
  END IF;

  IF v_np > 0 THEN
    UPDATE post_processes pp
       SET board_position = u.pos
      FROM unnest(p_process_ids, p_process_positions) AS u(id, pos)
     WHERE pp.id = u.id AND pp.conta_id = v_conta;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reorder_fluxos_board(bigint[], integer[], bigint[], integer[])
  TO authenticated, service_role;
