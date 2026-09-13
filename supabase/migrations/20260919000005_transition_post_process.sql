-- supabase/migrations/20260919000005_transition_post_process.sql
-- Avancar, voltar, concluir e reabrir um processo individual
-- (spec secoes 5.5, 6.2, 7, 9.4).
--
-- CONCORRENCIA. p_expected_revisao e a versao esperada do processo; divergiu,
-- process_changed, antes de qualquer escrita. Quando o comando tambem mexe no
-- post, p_expected_post_status e a versao esperada do post; divergiu,
-- post_changed. Nos fluxos, preparar o proximo ciclo e avancar sao dois PATCH
-- com rearmFailed; aqui e uma transacao so, e isso e uma melhoria aceita.
--
-- ORDEM DE LOCKS: advisory ':post_move' primeiro (reabrir volta o processo a
-- vigente e cai na mesma regra do INSERT), depois a linha do POST e so entao a
-- do PROCESSO, a mesma ordem de attach_post_closing_process.
--
-- APROVACAO (secoes 5.5 e 6.2). A arvore vale para 'avancar' E para
-- 'concluir': a 5.5 diz que concluir a ultima etapa, quando ela e
-- aprovacao_cliente com pendencia, "abre o mesmo dialogo de escolha dos
-- fluxos". Sem isso, aprovar internamente e concluir viraria dois passos nao
-- atomicos na UI, exatamente o que a 6.2 quer evitar no caminho individual. A
-- unica parte que nao vale para concluir e o re-arm: nao ha proximo ciclo.
-- As pre-checagens de 'avancar' (no_next_step, next_deadline_required) rodam
-- ANTES da arvore, para que "nao ha proxima etapa" continue sendo a primeira
-- resposta de um avancar na ultima etapa. Liberado = status em
-- (aprovado_cliente, agendado, postado, falha_publicacao). Nao liberado exige
-- p_approval_choice: 'aprovar_interno' grava aprovado_cliente fora de
-- agendado/postado (identico a approvePostsInternally, apesar do nome) ou
-- 'sem_alterar', que nunca toca status, custom status nem aprovacoes. Liberado
-- com outra etapa aprovacao_cliente PENDENTE adiante re-arma o ciclo: so
-- aprovado_cliente volta a rascunho (identico a resetApprovedPostsForNextCycle),
-- nunca agendado/postado/falha_publicacao. Etapas herdado, ignorado, concluido
-- e interrompido nao contam como aprovacao adiante. Toda escrita de status
-- passa pelo trigger z1 e pode zerar custom_status_id, como nos fluxos.
--
-- CONCLUIR (secao 5.5). "Concluir a ultima etapa marca so o processo como
-- concluido": o comando so vale quando a etapa ativa e a ultima que importa.
-- Etapa de ordem maior ainda PENDENTE responde pending_steps_remaining, antes
-- de qualquer escrita e antes da arvore de aprovacao. Etapas adiante em
-- herdado, ignorado, concluido ou interrompido nao bloqueiam: nenhuma delas
-- espera ser feita. Como toda etapa que re-armaria o ciclo esta pendente, essa
-- pre-checagem torna o re-arm impossivel por construcao dentro de 'concluir'.

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
  v_tem_adiante  boolean;
  v_liberado     boolean;
  v_estado       text;
  v_ponteiro     integer;
  v_revisao      integer;
  v_steps        jsonb;
BEGIN
  IF p_command IS NULL OR p_command NOT IN ('avancar', 'voltar', 'concluir', 'reabrir') THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = 'P0001';
  END IF;
  IF p_approval_choice IS NOT NULL AND p_approval_choice NOT IN ('aprovar_interno', 'sem_alterar') THEN
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
    -- mesmo dialogo do avancar. v_tem_adiante e falso em 'concluir': o re-arm
    -- so faz sentido com um proximo ciclo e, depois da pre-checagem acima, nao
    -- existe etapa pendente adiante para re-armar. O ramo fica explicito por
    -- defesa, nao porque seja alcancavel.
    IF p_command IN ('avancar', 'concluir') AND v_atual.tipo = 'aprovacao_cliente' THEN
      IF p_expected_post_status IS NULL THEN
        RAISE EXCEPTION 'expected_post_status_required' USING ERRCODE = 'P0001';
      END IF;
      IF p_expected_post_status IS DISTINCT FROM v_status THEN
        RAISE EXCEPTION 'post_changed' USING ERRCODE = 'P0001';
      END IF;

      v_liberado := v_status IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');
      IF p_command = 'avancar' THEN
        SELECT EXISTS (SELECT 1 FROM post_process_steps s
                        WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem
                          AND s.tipo = 'aprovacao_cliente' AND s.estado = 'pendente')
          INTO v_tem_adiante;
      ELSE
        v_tem_adiante := false;
      END IF;

      IF NOT v_liberado THEN
        IF p_approval_choice IS NULL THEN
          RAISE EXCEPTION 'approval_choice_required' USING ERRCODE = 'P0001';
        END IF;
        IF p_approval_choice = 'aprovar_interno' AND v_status NOT IN ('agendado', 'postado') THEN
          v_novo_status := 'aprovado_cliente';
        END IF;
      ELSIF v_tem_adiante AND v_status = 'aprovado_cliente' THEN
        v_novo_status := 'rascunho';
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
