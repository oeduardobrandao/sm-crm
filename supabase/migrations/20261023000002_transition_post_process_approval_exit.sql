-- supabase/migrations/20261023000002_transition_post_process_approval_exit.sql
-- Saida de passo de aprovacao com escolha explicita de status no processo
-- individual (spec docs/superpowers/specs/2026-10-21-saida-etapa-aprovacao-design.md).
--
-- transition_post_process: MESMA assinatura de 20260919000005, corpo copiado
-- com estas mudancas na arvore de aprovacao:
--   * o re-arm automatico SAIU. Post liberado (aprovado_cliente, agendado,
--     postado, falha_publicacao) com outra aprovacao_cliente pendente adiante
--     nao volta mais a rascunho sozinho: sem escolha, nada muda no post;
--   * nova escolha 'voltar_rascunho': grava rascunho (no-op se ja for);
--     'concluir' responde invalid_approval_choice (nao ha proximo ciclo) e
--     post agendado, postado ou falha_publicacao responde post_locked, ambos
--     antes de qualquer escrita;
--   * 'aprovar_interno' e 'sem_alterar' seguem iguais, e a escolha continua
--     obrigatoria (approval_choice_required) so para post nao liberado.
-- Resto do contrato (concorrencia por revisao e status esperado, ordem de
-- locks, pre-checagens de avancar/concluir) igual ao de 20260919000005.
--
-- resolve_post_process_rascunho_banner: banner "post aprovado no ciclo
-- anterior" do processo. Ciclo = maior concluido_em entre os passos
-- aprovacao_cliente concluidos; p_expected_ciclo divergente, ciclo_changed.
-- p_reset volta a rascunho SO post aprovado_cliente (agendado, postado e
-- falha_publicacao nunca, nem os post_targets). Sempre grava
-- aviso_rascunho_dispensado_em (dispensa vale para a equipe toda). Mesma ordem
-- de locks de transition_post_process (advisory ':post_move', post, processo)
-- e NAO incrementa revisao: nao e transicao de etapa. post_processes so tem
-- SELECT para authenticated, entao a escrita da coluna passa por aqui.
-- duplicate_post/apply/detach inserem com lista explicita de colunas: a coluna
-- nova nasce NULL nas copias, de proposito.
-- O reset confere no servidor as condicoes de postRascunhoBanner
-- (apps/crm/src/pages/entregas/approvalExit.ts): processo ativo, passo ativo
-- padrao, passo aprovacao_cliente pendente adiante e banner ainda nao
-- resolvido neste ciclo (aviso_rascunho_dispensado_em nulo ou anterior ao
-- ciclo). Falhou alguma, ciclo_changed (estado velho no CRM). Como o reset
-- carimba a dispensa, um segundo reset no mesmo ciclo falha. A dispensa sem
-- reset fica leniente. Reset que muda o post grava o evento 'voltou_rascunho'
-- no historico do processo, no formato do 'avancou' de transition_post_process
-- (etapa e post_status em antes/depois, approval_choice em depois).

ALTER TABLE public.post_processes
  ADD COLUMN IF NOT EXISTS aviso_rascunho_dispensado_em timestamptz NULL;

-- Novo evento de historico. Lista anterior: 20260918000002.
ALTER TABLE public.post_process_events
  DROP CONSTRAINT IF EXISTS post_process_events_evento_check;
ALTER TABLE public.post_process_events
  ADD CONSTRAINT post_process_events_evento_check CHECK (evento IN (
    'desmembrado', 'aplicado', 'avancou', 'voltou', 'concluido',
    'reaberto', 'removido', 'vinculado', 'etapa_editada', 'voltou_rascunho'));

CREATE OR REPLACE FUNCTION public.transition_post_process(
  p_process_id           bigint,
  p_expected_revisao     integer,
  p_command              text,
  p_approval_choice      text        DEFAULT NULL,
  p_expected_post_status text        DEFAULT NULL,
  p_next_deadline        timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta        uuid := public.post_process_require_editor();
  v_post_id      bigint;
  v_proc         record;
  v_status       text;
  v_novo_status  text;
  v_mudou_post   boolean := false;
  v_atual        record;
  v_prox         record;
  v_ant          record;
  v_liberado     boolean;
  v_estado       text;
  v_ponteiro     integer;
  v_revisao      integer;
  v_steps        jsonb;
BEGIN
  IF p_command IS NULL OR p_command NOT IN ('avancar', 'voltar', 'concluir', 'reabrir') THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = 'P0001';
  END IF;
  IF p_approval_choice IS NOT NULL
     AND p_approval_choice NOT IN ('aprovar_interno', 'sem_alterar', 'voltar_rascunho') THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT wp.status INTO v_status FROM workflow_posts wp
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

  v_estado   := v_proc.estado;
  v_ponteiro := v_proc.etapa_atual;

  IF p_command = 'reabrir' THEN
    IF v_proc.estado <> 'concluido' THEN
      RAISE EXCEPTION 'process_not_concluded' USING ERRCODE = 'P0001';
    END IF;
    -- Preserva iniciado_em e prazo_efetivo, inclusive vencidos. Divergencia
    -- deliberada em relacao a reopenWorkflow, que reinicia a contagem.
    UPDATE post_process_steps
       SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
     WHERE process_id = p_process_id AND ordem = v_proc.etapa_atual;
    v_estado := 'ativo';
    PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'reaberto',
      jsonb_build_object('estado', 'concluido'),
      jsonb_build_object('estado', 'ativo', 'etapa_atual', v_ponteiro));
  ELSE
    IF v_proc.estado <> 'ativo' THEN
      RAISE EXCEPTION 'process_not_active' USING ERRCODE = 'P0001';
    END IF;

    SELECT s.ordem, s.nome, s.tipo INTO v_atual
      FROM post_process_steps s
     WHERE s.process_id = p_process_id AND s.estado = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
    END IF;

    -- PRE-CHECAGENS DE 'avancar', antes da arvore de aprovacao. Sem proxima
    -- etapa pendente o comando certo e 'concluir' (Decisao 12), e essa
    -- mensagem tem de chegar ao usuario antes de qualquer exigencia do
    -- dialogo de aprovacao.
    IF p_command = 'avancar' THEN
      SELECT s.ordem, s.nome, s.prazo_dias, s.prazo_efetivo INTO v_prox
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem AND s.estado = 'pendente'
       ORDER BY s.ordem LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_next_step' USING ERRCODE = 'P0001';
      END IF;
      IF p_next_deadline IS NULL AND v_prox.prazo_efetivo IS NULL AND v_prox.prazo_dias IS NOT NULL THEN
        RAISE EXCEPTION 'next_deadline_required' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- PRE-CHECAGEM DE 'concluir' (Decisao 12, secao 5.5). Concluir e para a
    -- ultima etapa que importa: etapa de ordem maior ainda pendente derruba o
    -- comando antes de qualquer escrita e antes da arvore de aprovacao, para
    -- que "ainda ha etapas pendentes" chegue ao usuario antes de qualquer
    -- exigencia do dialogo. Estados herdado, ignorado, concluido e
    -- interrompido nao bloqueiam.
    IF p_command = 'concluir' AND EXISTS (
         SELECT 1 FROM post_process_steps s
          WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem
            AND s.estado = 'pendente') THEN
      RAISE EXCEPTION 'pending_steps_remaining' USING ERRCODE = 'P0001';
    END IF;

    -- ARVORE DE APROVACAO, compartilhada por 'avancar' e 'concluir'. Ver a
    -- nota do topo: a 5.5 manda concluir sobre etapa aprovacao_cliente abrir o
    -- mesmo dialogo do avancar. Sem re-arm automatico desde 20261023000002:
    -- voltar a rascunho e a escolha explicita 'voltar_rascunho'.
    IF p_command IN ('avancar', 'concluir') AND v_atual.tipo = 'aprovacao_cliente' THEN
      IF p_expected_post_status IS NULL THEN
        RAISE EXCEPTION 'expected_post_status_required' USING ERRCODE = 'P0001';
      END IF;
      IF p_expected_post_status IS DISTINCT FROM v_status THEN
        RAISE EXCEPTION 'post_changed' USING ERRCODE = 'P0001';
      END IF;

      v_liberado := v_status IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');

      IF p_approval_choice = 'voltar_rascunho' THEN
        -- Concluir nao tem proximo ciclo para onde voltar.
        IF p_command = 'concluir' THEN
          RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
        END IF;
        IF v_status IN ('agendado', 'postado', 'falha_publicacao') THEN
          RAISE EXCEPTION 'post_locked' USING ERRCODE = 'P0001';
        END IF;
        IF v_status <> 'rascunho' THEN
          v_novo_status := 'rascunho';
        END IF;
      ELSIF NOT v_liberado THEN
        IF p_approval_choice IS NULL THEN
          RAISE EXCEPTION 'approval_choice_required' USING ERRCODE = 'P0001';
        END IF;
        IF p_approval_choice = 'aprovar_interno' AND v_status NOT IN ('agendado', 'postado') THEN
          v_novo_status := 'aprovado_cliente';
        END IF;
      END IF;

      IF v_novo_status IS NOT NULL THEN
        UPDATE workflow_posts SET status = v_novo_status
         WHERE id = v_post_id AND conta_id = v_conta;
        v_status := v_novo_status;
        v_mudou_post := true;
      END IF;
    END IF;

    IF p_command = 'concluir' THEN
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      v_estado := 'concluido';
      -- Ponteiro na etapa que ACABOU de ser concluida, nao no valor lido do
      -- processo: se os dois divergirem, reabrir reativaria a etapa errada.
      v_ponteiro := v_atual.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'concluido',
        jsonb_build_object('estado', 'ativo', 'etapa_atual', v_proc.etapa_atual,
                           'post_status', p_expected_post_status),
        jsonb_build_object('estado', 'concluido', 'etapa_atual', v_atual.ordem,
                           'post_status', v_status, 'approval_choice', p_approval_choice));

    ELSIF p_command = 'voltar' THEN
      SELECT s.ordem, s.nome INTO v_ant
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem < v_atual.ordem
       ORDER BY s.ordem DESC LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_previous_step' USING ERRCODE = 'P0001';
      END IF;
      -- Uma etapa ativa por processo (indice parcial): a atual sai antes.
      UPDATE post_process_steps SET estado = 'pendente', iniciado_em = NULL
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
       WHERE process_id = p_process_id AND ordem = v_ant.ordem;
      v_ponteiro := v_ant.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'voltou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome),
        jsonb_build_object('etapa_ordem', v_ant.ordem, 'etapa_nome', v_ant.nome));

    ELSE  -- avancar. v_prox e a arvore de aprovacao ja rodaram acima.
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', iniciado_em = now(),
             prazo_efetivo = coalesce(p_next_deadline, prazo_efetivo)
       WHERE process_id = p_process_id AND ordem = v_prox.ordem;
      v_ponteiro := v_prox.ordem;

      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'avancou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome,
                           'post_status', p_expected_post_status),
        jsonb_build_object('etapa_ordem', v_prox.ordem, 'etapa_nome', v_prox.nome,
                           'post_status', v_status, 'approval_choice', p_approval_choice));
    END IF;
  END IF;

  -- Este UPDATE toca a coluna estado, entao passa pelo trigger
  -- post_processes_requires_avulso. Em 'reabrir' (concluido -> ativo) o guard
  -- faz early-return, porque a condicao dele e old.estado = 'encerrado': nao e
  -- obvio, mas e o que faz reabrir nao precisar reler o post. O trigger
  -- set_post_process_concluido_em, endurecido na Task 2, limpa concluido_em em
  -- qualquer transicao para 'ativo' e carimba em 'concluido'.
  UPDATE post_processes
     SET estado = v_estado, etapa_atual = v_ponteiro, revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em, s.concluido_em
      FROM post_process_steps s WHERE s.process_id = p_process_id) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', p_process_id,
    'post_id', v_post_id,
    'command', p_command,
    'estado', v_estado,
    'etapa_atual', v_ponteiro,
    'revisao', v_revisao,
    'post_status', v_status,
    'post_status_changed', v_mudou_post,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_post_process(bigint, integer, text, text, text, timestamptz)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transition_post_process(bigint, integer, text, text, text, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_post_process_rascunho_banner(
  p_process_id     bigint,
  p_expected_ciclo timestamptz,
  p_reset          boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_ativo   record;
  v_ciclo   timestamptz;
  v_n       integer := 0;
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

  SELECT pp.estado, pp.aviso_rascunho_dispensado_em INTO v_proc FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT max(s.concluido_em) INTO v_ciclo FROM post_process_steps s
   WHERE s.process_id = p_process_id
     AND s.tipo = 'aprovacao_cliente' AND s.estado = 'concluido';
  IF v_ciclo IS NULL OR v_ciclo IS DISTINCT FROM p_expected_ciclo THEN
    RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_reset, false) THEN
    -- Guardas do reset (ver o topo).
    IF v_proc.estado IS DISTINCT FROM 'ativo' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    SELECT s.ordem, s.nome, s.tipo INTO v_ativo FROM post_process_steps s
     WHERE s.process_id = p_process_id AND s.estado = 'ativo';
    IF NOT FOUND OR v_ativo.tipo IS DISTINCT FROM 'padrao' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM post_process_steps s
          WHERE s.process_id = p_process_id AND s.tipo = 'aprovacao_cliente'
            AND s.estado = 'pendente' AND s.ordem > v_ativo.ordem) THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF v_proc.aviso_rascunho_dispensado_em IS NOT NULL
       AND v_proc.aviso_rascunho_dispensado_em >= v_ciclo THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;

    UPDATE workflow_posts SET status = 'rascunho'
     WHERE id = v_post_id AND conta_id = v_conta
       AND status = 'aprovado_cliente';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'voltou_rascunho',
        jsonb_build_object('etapa_ordem', v_ativo.ordem, 'etapa_nome', v_ativo.nome,
                           'post_status', 'aprovado_cliente'),
        jsonb_build_object('etapa_ordem', v_ativo.ordem, 'etapa_nome', v_ativo.nome,
                           'post_status', 'rascunho', 'approval_choice', 'voltar_rascunho'));
    END IF;
  END IF;

  UPDATE post_processes SET aviso_rascunho_dispensado_em = now()
   WHERE id = p_process_id AND conta_id = v_conta;

  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_post_process_rascunho_banner(bigint, timestamptz, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_process_rascunho_banner(bigint, timestamptz, boolean)
  TO authenticated, service_role;
