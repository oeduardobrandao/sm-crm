-- Endurecimento do schema da fase 1 e helpers internos da fase 2.
--
-- Fecha os minors diferidos no ledger da fase 1 (M1, M2, M4) e publica os
-- tres helpers que TODAS as RPCs desta fase usam. Nada aqui muda
-- comportamento de producao: nao existe processo nenhum no banco.

-- ------------------------------------------------------------------
-- 1. M2: indices das FKs compostas com SET NULL. Sem eles, todo DELETE em
-- workflows (inclusive o passo 2 do cron de limpeza, um fluxo por vez) e todo
-- DELETE de template varrem post_processes inteira para aplicar a acao
-- referencial. De graca hoje (zero linhas), caro depois.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_post_processes_template ON public.post_processes (template_id);
CREATE INDEX IF NOT EXISTS idx_post_processes_origem   ON public.post_processes (origem_workflow_id);

-- ------------------------------------------------------------------
-- 2. M1: concluido_em precisa ser limpo em QUALQUER transicao para ativo, nao
-- so vindo de concluido. Sem isso, concluido -> encerrado -> ativo (remover e
-- depois desmembrar de novo nao acontece, mas vincular e reabrir sim) deixa um
-- carimbo velho que a UI mostraria como data de conclusao de um processo em
-- andamento. Corpo identico ao de 20260918000002 fora do ELSIF.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_post_process_concluido_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.estado IS DISTINCT FROM new.estado THEN
    IF new.estado = 'concluido' THEN
      new.concluido_em := now();
    ELSIF new.estado = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- ------------------------------------------------------------------
-- 3. M4: o default ACL hosted deixa USAGE nas sequences novas para
-- anon/authenticated. Inofensivo (INSERT ja e negado por grant e por RLS), mas
-- a migration passa a se descrever sozinha.
-- ------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.post_processes_id_seq, public.post_process_steps_id_seq,
  public.post_process_events_id_seq TO service_role;

-- ------------------------------------------------------------------
-- 4. Helper de identidade e permissao. SECURITY INVOKER de proposito: quando
-- chamado de dentro de uma RPC SECURITY DEFINER, o current_user ja e o dono
-- (postgres), que e o unico role com EXECUTE em has_permission_for
-- (20260903000002 revoga de authenticated). auth.uid() e get_my_conta_id()
-- leem o JWT da requisicao e nao mudam com SECURITY DEFINER.
--
-- permission_denied: nao havia precedente exato de RPC que negasse por
-- has_permission_for; a casa usa identificador + P0001 em toda a familia
-- detach/attach/move, e o vizinho mais proximo (financial_access_denied,
-- 20260904000002) tambem e identificador com P0001.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_require_editor()
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_conta;
END;
$$;

-- Decisao 26: revogado tambem de service_role. Nenhum grant e necessario: as
-- RPCs SECURITY DEFINER desta fase sao do mesmo dono e chamam o helper como
-- dono, que executa por ser dono. Deixar implicito faria a checagem da Task 9
-- depender do default ACL do projeto.
REVOKE ALL ON FUNCTION public.post_process_require_editor() FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 5. Helper de historico. Mesma resolucao de actor/actor_name de
-- record_workflow_event (20260826000001): nome em snapshot vindo de
-- profiles.nome, que sobrevive a saida do membro. origem 'system' quando o
-- chamador pediu ou quando nao ha usuario (chamada por service_role).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_log_event(
  p_conta      uuid,
  p_post_id    bigint,
  p_process_id bigint,
  p_evento     text,
  p_antes      jsonb,
  p_depois     jsonb,
  p_origem     text DEFAULT 'workspace_user'
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_nome  text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT p.nome INTO v_nome FROM profiles p WHERE p.id = v_actor;
  END IF;
  INSERT INTO post_process_events
    (conta_id, post_id, process_id, evento, actor_user_id, actor_name, origem, antes, depois)
  VALUES
    (p_conta, p_post_id, p_process_id, p_evento, v_actor, v_nome,
     CASE WHEN v_actor IS NULL OR p_origem = 'system' THEN 'system' ELSE 'workspace_user' END,
     p_antes, p_depois);
END;
$$;

REVOKE ALL ON FUNCTION public.post_process_log_event(uuid, bigint, bigint, text, jsonb, jsonb, text)
  FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 6. Assinatura reconstruida do snapshot. As RPCs gravam
-- post_processes.assinatura a partir da FONTE (etapas do fluxo ou jsonb do
-- template), porque a coluna e NOT NULL e o INSERT do processo precede o das
-- etapas. Esta funcao existe para o outro lado: leitura e verificacao. As
-- suites fixam a igualdade entre o que foi gravado e o que ela reconstroi.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_process_assinatura(p_process_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(string_agg(s.ordem::text || '|' || s.nome || '|' || s.tipo, chr(10) ORDER BY s.ordem), '')
    FROM post_process_steps s
   WHERE s.process_id = p_process_id;
$$;

REVOKE ALL ON FUNCTION public.post_process_assinatura(bigint) FROM public, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. A limpeza de Express passa a poupar tambem o rascunho avulso cujo
-- processo esta 'concluido' (Decisao 25).
--
-- POR QUE AQUI. A fase 2 cria o unico caminho para um processo chegar a
-- 'concluido' (transition_post_process com o comando 'concluir'), e por
-- desenho da spec (secoes 5.1, 5.2, 6.2 e criterio 12.4) NENHUM comando de
-- processo altera o status do post: um Express avulso com o processo inteiro
-- concluido continua 'rascunho'. Passado o cutoff, o passo 3 do
-- express-post-cleanup-cron o entregaria a esta RPC, o NOT EXISTS antigo
-- (so 'ativo') nao o pouparia, e o DELETE levaria por CASCADE o processo, as
-- etapas e todo o post_process_events. O defeito nasce nesta fase, entao e
-- aqui que ele fecha.
--
-- 'encerrado' continua NAO poupando, de proposito: removido ou vinculado, o
-- post voltou a Sem processo e e um rascunho abandonado como qualquer outro.
-- O historico daquele processo encerrado vai junto no CASCADE, o que e
-- aceitavel na v1 e esta registrado na Decisao 25.
--
-- Corpo identico ao de 20260918000004 fora do NOT EXISTS. E a RPC, e nao o
-- pre-filtro do handler, que garante a regra (o comentario daquela migration e
-- a secao 10 da spec dizem isso). NENHUMA edge function muda: o pre-filtro
-- continua com .eq("estado", "ativo") e os ids poupados a mais ja entram em
-- avulso_skipped_with_process, que o handler soma DEPOIS da RPC comparando os
-- ids enviados com os devolvidos.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_cleanup_delete_avulso_drafts(p_ids bigint[])
RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint[];
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '{}'::bigint[];
  END IF;

  PERFORM 1 FROM workflow_posts wp
    WHERE wp.id = ANY (p_ids)
    ORDER BY wp.id
    FOR UPDATE;

  WITH del AS (
    DELETE FROM workflow_posts wp
     WHERE wp.id = ANY (p_ids)
       AND wp.is_express
       AND wp.workflow_id IS NULL
       AND wp.status = 'rascunho'
       AND NOT EXISTS (
         SELECT 1 FROM post_processes pp
          WHERE pp.post_id = wp.id AND pp.estado IN ('ativo', 'concluido')
       )
    RETURNING wp.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::bigint[]) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- CREATE OR REPLACE preserva o ACL, mas repetir mantem a migration
-- autodescritiva, no mesmo molde de 20260918000004.
REVOKE ALL ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) TO service_role;
