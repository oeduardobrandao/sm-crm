-- Vincular a um fluxo um post que tem execucao individual vigente
-- (spec secoes 5.5, 9.3, 9.5).
--
-- POR QUE ENCERRAR ANTES DE ANEXAR. post_a1_process_guard (20260918000003) e
-- um BEFORE UPDATE OF workflow_id em workflow_posts SEM GUC de escape: ele
-- levanta post_has_active_process sempre que um post com execucao 'ativo' ou
-- 'concluido' ganha workflow_id. Esta RPC nao contorna o guard, ela satisfaz o
-- guard: primeiro grava estado='encerrado', motivo='vinculado', e so entao faz
-- o UPDATE, na mesma transacao. Se algo falhar depois, o rollback devolve a
-- execucao vigente.
--
-- ORDEM DE LOCKS: ':post_move' -> ':max_posts_per_workflow' (a mesma chave de
-- enforce_plan_count_limit, e a mesma ordem do attach, para nao formar ciclo
-- com um INSERT concorrente em workflow_posts), depois fluxo FOR UPDATE, post
-- FOR UPDATE, processo FOR UPDATE.
--
-- Estado e prazos individuais nao sao transferidos para as etapas do fluxo: o
-- post passa a seguir as etapas compartilhadas, e o historico individual fica
-- guardado em post_process_events.

CREATE OR REPLACE FUNCTION public.attach_post_closing_process(
  p_post_id          bigint,
  p_workflow_id      bigint,
  p_expected_revisao integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_wf         record;
  v_post       record;
  v_proc       record;
  v_limit      bigint;
  v_current    bigint;
  v_max_ordem  integer;
  v_revisao    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  SELECT w.id, w.cliente_id, w.status INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wf.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  SELECT wp.id, wp.workflow_id, wp.cliente_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_already_in_flow' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.cliente_id IS DISTINCT FROM v_wf.cliente_id THEN
    RAISE EXCEPTION 'post_belongs_to_another_client' USING ERRCODE = 'P0001';
  END IF;

  -- A busca NAO filtra estado: trava a execucao mais recente do post e depois
  -- decide. Filtrar por IN ('ativo','concluido') faria um post cuja unica
  -- execucao ja esta 'encerrado' responder process_not_found, quando o
  -- contrato (e o que remove_post_process ja faz no caso equivalente) e
  -- process_already_closed. Sem execucao nenhuma, ai sim process_not_found.
  SELECT pp.id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
   ORDER BY pp.id DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Limite de posts por fluxo: trg_limit_posts so roda em INSERT e nunca
  -- dispara neste UPDATE, entao esta guarda e o unico enforcement possivel.
  -- Mesma fronteira do attach: atual + 1 = limite passa, limite + 1 estoura.
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current FROM workflow_posts
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta;
    IF v_current + 1 > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 1) Encerrar ANTES do attach (ver nota no topo).
  UPDATE post_process_steps SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = v_proc.id AND estado = 'ativo';
  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'vinculado', revisao = revisao + 1
   WHERE id = v_proc.id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, p_post_id, v_proc.id, 'vinculado',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'vinculado',
                       'workflow_id', p_workflow_id));

  -- 2) Attach, no mesmo desenho de attach_posts_to_flow.
  SELECT coalesce(max(ordem), -1) INTO v_max_ordem
    FROM workflow_posts WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts
     SET workflow_id = p_workflow_id, ordem = (v_max_ordem + 1)::integer
   WHERE id = p_post_id AND conta_id = v_conta;
  PERFORM set_config('app.allow_post_move', 'off', true);

  RETURN jsonb_build_object('ok', true, 'process_id', v_proc.id, 'post_id', p_post_id,
                            'workflow_id', p_workflow_id, 'estado', 'encerrado',
                            'motivo_encerramento', 'vinculado', 'revisao', v_revisao);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_post_closing_process(bigint, bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attach_post_closing_process(bigint, bigint, integer)
  TO authenticated, service_role;
