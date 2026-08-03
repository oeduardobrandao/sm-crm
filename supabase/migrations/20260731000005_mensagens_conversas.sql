-- supabase/migrations/20260731000005_mensagens_conversas.sql
-- Conversation-list aggregate for the CRM Mensagens inbox: one row per cliente
-- with the latest feed item (same three sources as get_mensagens_feed) and the
-- caller's unread count. CRM-only (authenticated); the hub has a single
-- conversation and needs no aggregate.
-- All column references are table-qualified: RETURNS TABLE names shadow them.

CREATE OR REPLACE FUNCTION get_mensagens_conversas()
RETURNS TABLE (
  cliente_id             bigint,
  cliente_nome           text,
  last_source            text,
  last_action            text,
  last_content           text,
  last_is_workspace_user boolean,
  last_author_name       text,
  last_created_at        timestamptz,
  unread_count           bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;

  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;

  SELECT ls.last_seen_at INTO v_since
    FROM mensagens_last_seen ls
   WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
  v_since := COALESCE(v_since, '-infinity'::timestamptz);

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, w.cliente_id AS f_cliente_id,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE w.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', w.cliente_id,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
      JOIN workflows w ON w.id = wp.workflow_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.cliente_id,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
  ),
  latest AS (
    SELECT DISTINCT ON (f.f_cliente_id)
           f.f_cliente_id, f.f_source, f.f_action, f.f_content,
           f.f_iwu, f.f_author, f.f_created_at
      FROM feed f
     ORDER BY f.f_cliente_id, f.f_created_at DESC
  ),
  unread AS (
    SELECT f.f_cliente_id, count(*)::bigint AS n
      FROM feed f
     WHERE f.f_iwu = false AND f.f_created_at > v_since
     GROUP BY f.f_cliente_id
  )
  SELECT l.f_cliente_id, c.nome,
         l.f_source, l.f_action, l.f_content,
         l.f_iwu, mb.nome, l.f_created_at,
         COALESCE(u.n, 0)
    FROM latest l
    JOIN clientes c ON c.id = l.f_cliente_id
    LEFT JOIN membros mb ON mb.crm_user_id = l.f_author AND mb.conta_id = v_conta
    LEFT JOIN unread u ON u.f_cliente_id = l.f_cliente_id
   ORDER BY l.f_created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_conversas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_conversas() TO authenticated;
