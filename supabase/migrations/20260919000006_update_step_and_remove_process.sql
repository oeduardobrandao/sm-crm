-- Editar responsavel e prazo de uma etapa individual, e remover a execucao
-- (spec secoes 5.4, 5.5, 7, 8.1).
--
-- ORDEM DE LOCKS. As duas tomam ':post_move' no topo e travam a linha do
-- POST antes da linha do PROCESSO, exatamente como transition_post_process.
-- Nao e higiene: as duas chamam post_process_log_event, que insere em
-- post_process_events, e essa tabela tem a FK composta
-- post_process_events_post_same_tenant (post_id, conta_id) REFERENCES
-- workflow_posts (20260918000002). Todo INSERT ali pede FOR KEY SHARE na
-- linha do post. Sem o advisory e sem travar o post antes, uma destas duas
-- RPCs segura post_processes FOR UPDATE e vai pedir FOR KEY SHARE no post
-- enquanto transition_post_process (ou apply, ou attach) ja segura o post FOR
-- UPDATE e vai pedir o processo: espera circular, 40P01. Seria tambem o
-- inverso da ordem declarada na constraint global do plano, fluxo -> post ->
-- processo. A leitura sem lock do post_id antes de travar e o mesmo truque de
-- transition_post_process (Decisao 22).
--
-- p_responsavel_id e p_prazo_efetivo sao setters absolutos: NULL limpa. A UI
-- envia sempre os dois valores do formulario, entao nao existe "nao mexer".

CREATE OR REPLACE FUNCTION public.update_post_process_step(
  p_process_id       bigint,
  p_expected_revisao integer,
  p_ordem            integer,
  p_responsavel_id   bigint      DEFAULT NULL,
  p_prazo_efetivo    timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_step    record;
  v_revisao integer;
  v_novo    jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.ordem, s.nome, s.estado, s.responsavel_id, s.prazo_efetivo INTO v_step
    FROM post_process_steps s
   WHERE s.process_id = p_process_id AND s.ordem = p_ordem;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_step.estado NOT IN ('pendente', 'ativo') THEN
    RAISE EXCEPTION 'step_not_editable' USING ERRCODE = 'P0001';
  END IF;

  IF p_responsavel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = p_responsavel_id AND m.conta_id = v_conta) THEN
    RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET responsavel_id = p_responsavel_id, prazo_efetivo = p_prazo_efetivo
   WHERE process_id = p_process_id AND ordem = p_ordem;

  UPDATE post_processes SET revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'etapa_editada',
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', v_step.responsavel_id, 'prazo_efetivo', v_step.prazo_efetivo),
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', p_responsavel_id, 'prazo_efetivo', p_prazo_efetivo));

  SELECT to_jsonb(y) INTO v_novo FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = p_process_id AND s.ordem = p_ordem) y;

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'ordem', p_ordem,
                            'revisao', v_revisao, 'step', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz)
  TO authenticated, service_role;

-- ============================================================
-- remove_post_process: encerra com motivo 'removido'. A etapa ativa vira
-- 'interrompido' (com carimbo) e as futuras ficam 'pendente', como manda a
-- invariante da secao 8.1. Encerrado e terminal: transition_post_process so
-- reabre a partir de 'concluido', entao uma etapa interrompida nunca volta a
-- contar como aprovacao adiante para hub-approve.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_post_process(
  p_process_id       bigint,
  p_expected_revisao integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_revisao integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Mesma leitura sem lock e mesma ordem post -> processo do update de etapa.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = p_process_id AND estado = 'ativo';

  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'removido', revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'removido',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'removido'));

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'post_id', v_proc.post_id,
                            'estado', 'encerrado', 'motivo_encerramento', 'removido',
                            'revisao', v_revisao);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_post_process(bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_post_process(bigint, integer) TO authenticated, service_role;
