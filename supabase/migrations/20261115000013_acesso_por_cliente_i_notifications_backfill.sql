-- Acesso por cliente: backfill de notifications.cliente_id (coluna em
-- 20261115000000) a partir do metadata das notificações já gravadas.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- Chaves, da mais específica para a menos (a mesma ordem da leitura por item,
-- 20261115000012): post_id, task_id, idea_id, linha_id, etapa_id, workflow_id
-- e, por fim, o cliente_id / client_id que client_message e a falha de
-- automação gravam no metadata. Cada UPDATE só toca linha ainda NULL, então a
-- primeira chave que acha o item decide (um post_id que não existe mais cai
-- para a chave seguinte, como o workflow_id). O join confere o workspace; id não
-- numérico (ou uuid inválido) fica de fora em vez de derrubar a migração: o
-- CASE só converte o que casou com o padrão (num AND o planner pode avaliar
-- o cast antes).
--
-- Em lotes de p_batch ids (keyset por notifications.id), para cada UPDATE
-- tocar no máximo p_batch linhas. Locks: ROW EXCLUSIVE em notifications (o
-- sino lê e os emissores inserem normalmente) e lock de linha em cada
-- notificação atualizada até o commit; só marcar como lida ou dispensar uma
-- dessas linhas espera. A migração inteira é uma transação, então o lote
-- limita o trabalho por comando, não o tempo de trava. Função para o teste
-- exercitar o mesmo código; EXECUTE só do dono da função.

CREATE OR REPLACE FUNCTION public._notifications_backfill_cliente_id(p_batch integer DEFAULT 10000)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_last  uuid := NULL;
  v_ids   uuid[];
  v_n     bigint;
  v_total bigint := 0;
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id) INTO v_ids
      FROM (SELECT n.id FROM public.notifications n
             WHERE n.cliente_id IS NULL AND (v_last IS NULL OR n.id > v_last)
             ORDER BY n.id
             LIMIT p_batch) b;
    EXIT WHEN v_ids IS NULL;
    v_last := v_ids[array_upper(v_ids, 1)];

    UPDATE public.notifications n SET cliente_id = wp.cliente_id
      FROM public.workflow_posts wp
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND wp.id = CASE WHEN n.metadata ->> 'post_id' ~ '^[0-9]{1,18}$' THEN (n.metadata ->> 'post_id')::bigint END
       AND wp.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.notifications n SET cliente_id = t.cliente_id
      FROM public.tarefas t
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND t.id = CASE WHEN n.metadata ->> 'task_id' ~ '^[0-9]{1,18}$' THEN (n.metadata ->> 'task_id')::bigint END
       AND t.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.notifications n SET cliente_id = i.cliente_id
      FROM public.ideias i
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND i.id = CASE WHEN n.metadata ->> 'idea_id' ~* v_uuid THEN (n.metadata ->> 'idea_id')::uuid END
       AND i.workspace_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.notifications n SET cliente_id = l.cliente_id
      FROM public.linhas_editoriais l
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND l.id = CASE WHEN n.metadata ->> 'linha_id' ~* v_uuid THEN (n.metadata ->> 'linha_id')::uuid END
       AND l.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.notifications n SET cliente_id = w.cliente_id
      FROM public.workflow_etapas e
      JOIN public.workflows w ON w.id = e.workflow_id
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND e.id = CASE WHEN n.metadata ->> 'etapa_id' ~ '^[0-9]{1,18}$' THEN (n.metadata ->> 'etapa_id')::bigint END
       AND w.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.notifications n SET cliente_id = w.cliente_id
      FROM public.workflows w
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND w.id = CASE WHEN n.metadata ->> 'workflow_id' ~ '^[0-9]{1,18}$' THEN (n.metadata ->> 'workflow_id')::bigint END
       AND w.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    -- sem chave de item: o cliente que o próprio metadata nomeia
    UPDATE public.notifications n SET cliente_id = c.id
      FROM public.clientes c
     WHERE n.id = ANY (v_ids) AND n.cliente_id IS NULL
       AND c.id = CASE WHEN COALESCE(n.metadata ->> 'cliente_id', n.metadata ->> 'client_id') ~ '^[0-9]{1,18}$'
                       THEN COALESCE(n.metadata ->> 'cliente_id', n.metadata ->> 'client_id')::bigint END
       AND c.conta_id = n.workspace_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  END LOOP;

  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public._notifications_backfill_cliente_id(integer)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_n bigint;
  acl text;
BEGIN
  v_n := public._notifications_backfill_cliente_id(10000);
  RAISE NOTICE 'notifications.cliente_id backfilled: % rows', v_n;

  SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc
   WHERE oid = 'public._notifications_backfill_cliente_id(integer)'::regprocedure;
  IF acl IS NULL OR acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%'
     OR acl LIKE '%service_role=X%' OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
    RAISE EXCEPTION '_notifications_backfill_cliente_id: unexpected EXECUTE grant — acl=%', acl;
  END IF;
END $$;
