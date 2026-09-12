-- Estende update_post_process_step para aceitar prazo_dias/tipo_prazo, além
-- de responsavel_id/prazo_efetivo (spec 2026-09-12-fluxos-posts-individuais-
-- ux-design.md §2). Editar etapa de um processo `modo_prazo = 'padrao'` passa
-- a usar prazo_dias + tipo_prazo como controle primário; o CRM sempre
-- recalcula prazo_efetivo a partir deles (computeDeadlineDate, âncora
-- iniciado_em) e envia os três juntos, porque etapaDeadlineDateOf dá
-- precedência a prazo_efetivo sobre prazo_dias/tipo_prazo -- mandar só os
-- dois novos sem atualizar o terceiro deixaria a data exibida presa ao valor
-- antigo. Processos `data_fixa`/`data_entrega` continuam só com data (cada
-- etapa já nasce com data fixa materializada) e não usam os parâmetros novos.
--
-- DROP antes do CREATE OR REPLACE: adicionar parâmetros muda a identidade da
-- função no Postgres (nome + tipos dos parâmetros de entrada). Um
-- CREATE OR REPLACE com uma lista de parâmetros diferente da existente cria
-- uma SEGUNDA função (overload), não troca a de 5 parâmetros definida em
-- 20260919000006_update_step_and_remove_process.sql -- então o DROP é
-- obrigatório para não deixar as duas assinaturas coexistindo.
--
-- Etapas futuras não são reancoradas por esta RPC -- mesma regra de hoje
-- (transition_post_process ancora a próxima etapa em now() ao ativá-la).

DROP FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz);

CREATE OR REPLACE FUNCTION public.update_post_process_step(
  p_process_id       bigint,
  p_expected_revisao integer,
  p_ordem            integer,
  p_responsavel_id   bigint      DEFAULT NULL,
  p_prazo_efetivo    timestamptz DEFAULT NULL,
  p_prazo_dias       integer     DEFAULT NULL,
  p_tipo_prazo       text        DEFAULT NULL
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
  IF p_tipo_prazo IS NOT NULL AND p_tipo_prazo NOT IN ('uteis', 'corridos') THEN
    RAISE EXCEPTION 'tipo_prazo_invalido' USING ERRCODE = 'P0001';
  END IF;

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

  SELECT pp.id, pp.post_id, pp.estado, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Etapa 'pendente'/'ativo' sozinha nao basta: remove deixa etapas futuras
  -- 'pendente' num processo ja encerrado, e sem esta guarda editar a etapa de
  -- uma execucao encerrada gravava responsavel/prazo, bumpava revisao e
  -- logava evento 'etapa_editada' num processo terminal. Mesmo codigo que
  -- transition_post_process ja usa para o mesmo caso.
  IF v_proc.estado <> 'ativo' THEN
    RAISE EXCEPTION 'process_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.ordem, s.nome, s.estado, s.responsavel_id, s.prazo_dias, s.tipo_prazo, s.prazo_efetivo
    INTO v_step
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
     SET responsavel_id = p_responsavel_id,
         prazo_efetivo  = p_prazo_efetivo,
         prazo_dias     = p_prazo_dias,
         tipo_prazo     = p_tipo_prazo
   WHERE process_id = p_process_id AND ordem = p_ordem;

  UPDATE post_processes SET revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'etapa_editada',
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', v_step.responsavel_id, 'prazo_efetivo', v_step.prazo_efetivo,
                       'prazo_dias', v_step.prazo_dias, 'tipo_prazo', v_step.tipo_prazo),
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', p_responsavel_id, 'prazo_efetivo', p_prazo_efetivo,
                       'prazo_dias', p_prazo_dias, 'tipo_prazo', p_tipo_prazo));

  SELECT to_jsonb(y) INTO v_novo FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = p_process_id AND s.ordem = p_ordem) y;

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'ordem', p_ordem,
                            'revisao', v_revisao, 'step', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz, integer, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_post_process_step(bigint, integer, integer, bigint, timestamptz, integer, text)
  TO authenticated, service_role;
