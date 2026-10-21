-- supabase/migrations/20261023000001_advance_workflow_from_approval.sql
-- Saida de etapa de aprovacao com escolha de status dos posts
-- (spec docs/superpowers/specs/2026-10-21-saida-etapa-aprovacao-design.md).
--
-- advance_workflow_from_approval: conclui a etapa aprovacao_cliente ativa de um
-- fluxo e, na mesma transacao, aplica a escolha do usuario aos posts:
--   manter           nao toca nenhum post;
--   aprovar_todos    so os pendentes (fora de aprovado_cliente, agendado,
--                    postado, falha_publicacao) viram aprovado_cliente. Mais
--                    restrito que approvePostsInternally de proposito: nao toca
--                    falha_publicacao;
--   voltar_rascunho  tudo fora de rascunho, agendado, postado e
--                    falha_publicacao volta a rascunho. Exige etapa adiante.
-- As escritas de etapa sao as mesmas de completeEtapa
-- (apps/crm/src/store/workflows.ts): proxima etapa por ordem, ponteiro
-- etapa_atual e o INDICE dela na lista ordenada; sem proxima, o fluxo conclui.
--
-- CONCORRENCIA. p_expected_etapa_id e a etapa ativa que o dialogo viu
-- (etapa_changed). Para as escolhas que mexem em post, p_expected_counts e a
-- contagem por status que o dialogo mostrou; divergiu, posts_changed, antes de
-- qualquer escrita. Chave ausente vale 0 nos dois lados.
--
-- ORDEM DE LOCKS: advisory ':post_move' (serializa contra as RPCs que mexem
-- em posts com o mesmo lock), depois a linha do fluxo, depois a etapa ativa e,
-- nas escolhas que conferem contagem, as linhas dos posts do fluxo FOR UPDATE
-- em ordem de id, ANTES de contar. O advisory sozinho nao basta: escrita
-- direta via PostgREST, hub-approve e o cron de publicacao nao o pegam, e sob
-- READ COMMITTED um post poderia mudar entre a contagem e o UPDATE. Com as
-- linhas travadas, quem escreve depois espera o commit, e quem escreveu antes
-- ja aparece na contagem. Post inserido no fluxo depois do lock nao e visto
-- (nao ha predicate lock); fica fora da contagem e do UPDATE.
--
-- resolve_workflow_rascunho_banner: o banner "posts aprovados no ciclo
-- anterior" do fluxo. Ciclo = maior concluido_em entre as etapas
-- aprovacao_cliente concluidas; p_expected_ciclo divergente, ciclo_changed.
-- p_reset volta so os aprovado_cliente a rascunho; sempre grava
-- aviso_rascunho_dispensado_em (dispensa vale para a equipe toda).
-- O reset confere no servidor as mesmas condicoes em que o banner aparece
-- (fluxoRascunhoBanner em apps/crm/src/pages/entregas/approvalExit.ts): fluxo
-- ativo, etapa ativa padrao, etapa aprovacao_cliente pendente adiante e banner
-- ainda nao resolvido neste ciclo (aviso_rascunho_dispensado_em nulo ou
-- anterior ao ciclo). Falhou alguma, ciclo_changed: o drawer estava velho (ex.:
-- outro membro ja avancou o fluxo para a aprovacao seguinte e o cliente
-- aprovou de novo) e o reset nao pode apagar aprovacoes que o usuario nao viu.
-- Como o reset carimba a dispensa, um segundo reset no mesmo ciclo falha.
-- A dispensa sem reset so grava o timestamp e fica leniente.
--
-- duplicate_workflow nao copia aviso_rascunho_dispensado_em: a copia nasce sem
-- dispensa (default NULL de proposito).

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS aviso_rascunho_dispensado_em timestamptz NULL;

CREATE OR REPLACE FUNCTION public.advance_workflow_from_approval(
  p_workflow_id       bigint,
  p_expected_etapa_id bigint,
  p_choice            text,
  p_expected_counts   jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta     uuid;
  v_wf        record;
  v_atual     record;
  v_prox      record;
  v_tem_prox  boolean;
  v_actual    jsonb;
  v_divergiu  boolean;
  v_changed   integer := 0;
  v_status    text;
  v_ponteiro  integer;
BEGIN
  IF p_choice IS NULL OR p_choice NOT IN ('manter', 'aprovar_todos', 'voltar_rascunho') THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  v_conta := public.post_process_require_editor();

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT w.id, w.status INTO v_wf FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Fluxo arquivado (move_posts_* arquiva a origem) pode guardar etapa ativa:
  -- um confirm velho nao pode concluir esse fluxo.
  IF v_wf.status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- workflow_etapas nao tem conta_id: o escopo vem do fluxo travado acima.
  SELECT e.id, e.ordem, e.tipo INTO v_atual FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo'
   ORDER BY e.ordem LIMIT 1
     FOR UPDATE;
  IF NOT FOUND OR v_atual.id IS DISTINCT FROM p_expected_etapa_id THEN
    RAISE EXCEPTION 'etapa_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_atual.tipo IS DISTINCT FROM 'aprovacao_cliente' THEN
    RAISE EXCEPTION 'not_approval_etapa' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.id, e.ordem INTO v_prox FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.ordem > v_atual.ordem
   ORDER BY e.ordem LIMIT 1;
  v_tem_prox := FOUND;
  IF NOT v_tem_prox AND p_choice = 'voltar_rascunho' THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  IF p_choice IN ('aprovar_todos', 'voltar_rascunho') THEN
    IF p_expected_counts IS NULL OR jsonb_typeof(p_expected_counts) <> 'object' THEN
      RAISE EXCEPTION 'expected_counts_required' USING ERRCODE = 'P0001';
    END IF;

    -- Trava os posts do fluxo antes de contar (ver ORDEM DE LOCKS no topo).
    PERFORM 1 FROM workflow_posts wp
     WHERE wp.workflow_id = p_workflow_id AND wp.conta_id = v_conta
     ORDER BY wp.id
       FOR UPDATE;

    SELECT coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb) INTO v_actual
      FROM (SELECT wp.status, count(*) AS n FROM workflow_posts wp
             WHERE wp.workflow_id = p_workflow_id AND wp.conta_id = v_conta
             GROUP BY wp.status) c;

    -- Comparacao por chave sobre a uniao das chaves; ausente = 0. Igualdade
    -- de jsonb, entao valor nao numerico no esperado so diverge, sem erro de cast.
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT jsonb_object_keys(p_expected_counts) AS k
        UNION
        SELECT jsonb_object_keys(v_actual)) keys
       WHERE coalesce(p_expected_counts -> keys.k, '0'::jsonb)
             IS DISTINCT FROM coalesce(v_actual -> keys.k, '0'::jsonb))
      INTO v_divergiu;
    IF v_divergiu THEN
      RAISE EXCEPTION 'posts_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_choice = 'aprovar_todos' THEN
    UPDATE workflow_posts SET status = 'aprovado_cliente'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status NOT IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSIF p_choice = 'voltar_rascunho' THEN
    UPDATE workflow_posts SET status = 'rascunho'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status NOT IN ('rascunho', 'agendado', 'postado', 'falha_publicacao');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  -- Mesmas escritas de completeEtapa. Os triggers workflow_etapas_updated_event
  -- e notify_step_activated disparam sozinhos.
  UPDATE workflow_etapas SET status = 'concluido', concluido_em = now()
   WHERE id = v_atual.id;

  IF v_tem_prox THEN
    UPDATE workflow_etapas SET status = 'ativo', iniciado_em = now()
     WHERE id = v_prox.id;
    SELECT count(*) INTO v_ponteiro FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.ordem < v_prox.ordem;
    UPDATE workflows SET etapa_atual = v_ponteiro
     WHERE id = p_workflow_id
    RETURNING status INTO v_status;
  ELSE
    SELECT count(*) INTO v_ponteiro FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.ordem < v_atual.ordem;
    UPDATE workflows SET status = 'concluido', etapa_atual = v_ponteiro
     WHERE id = p_workflow_id
    RETURNING status INTO v_status;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_status', v_status,
    'etapa_atual', v_ponteiro,
    'posts_changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_workflow_from_approval(bigint, bigint, text, jsonb)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.advance_workflow_from_approval(bigint, bigint, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_workflow_rascunho_banner(
  p_workflow_id    bigint,
  p_expected_ciclo timestamptz,
  p_reset          boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.post_process_require_editor();
  v_wf    record;
  v_ativa record;
  v_ciclo timestamptz;
  v_n     integer := 0;
BEGIN
  -- Mesma ordem de locks de advance_workflow_from_approval.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT w.status, w.aviso_rascunho_dispensado_em INTO v_wf FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT max(e.concluido_em) INTO v_ciclo FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id
     AND e.tipo = 'aprovacao_cliente' AND e.status = 'concluido';
  IF v_ciclo IS NULL OR v_ciclo IS DISTINCT FROM p_expected_ciclo THEN
    RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_reset, false) THEN
    -- Guardas do reset (ver o topo). Mesmo codigo do ciclo: o CRM trata como
    -- estado velho e recarrega.
    IF v_wf.status IS DISTINCT FROM 'ativo' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    SELECT e.ordem, e.tipo INTO v_ativa FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo'
     ORDER BY e.ordem LIMIT 1;
    IF NOT FOUND OR v_ativa.tipo IS DISTINCT FROM 'padrao' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM workflow_etapas e
          WHERE e.workflow_id = p_workflow_id AND e.tipo = 'aprovacao_cliente'
            AND e.status = 'pendente' AND e.ordem > v_ativa.ordem) THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF v_wf.aviso_rascunho_dispensado_em IS NOT NULL
       AND v_wf.aviso_rascunho_dispensado_em >= v_ciclo THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;

    UPDATE workflow_posts SET status = 'rascunho'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status = 'aprovado_cliente';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  UPDATE workflows SET aviso_rascunho_dispensado_em = now()
   WHERE id = p_workflow_id;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_workflow_rascunho_banner(bigint, timestamptz, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_workflow_rascunho_banner(bigint, timestamptz, boolean)
  TO authenticated, service_role;
