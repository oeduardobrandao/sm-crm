-- supabase/migrations/20260731000007_conversas_instagram_avatar.sql
-- get_mensagens_conversas v3: adds cliente_foto_url (the connected Instagram
-- profile picture, same source hub-bootstrap uses) so the CRM inbox can show
-- real client avatars. Best-effort: clients without a connected account get
-- NULL and the UI falls back to sigla/cor initials.
-- NOTE: the return signature changes (new column), so the old function is
-- dropped first; grants are re-issued below.

DROP FUNCTION IF EXISTS get_mensagens_conversas();

CREATE FUNCTION get_mensagens_conversas()
RETURNS TABLE (
  cliente_id             bigint,
  cliente_nome           text,
  cliente_foto_url       text,
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
  SELECT c.id, c.nome, ig.profile_picture_url,
         l.f_source, l.f_action, l.f_content,
         l.f_iwu, mb.nome, l.f_created_at,
         COALESCE(u.n, 0)
    FROM clientes c
    LEFT JOIN LATERAL (
      SELECT ia.profile_picture_url
        FROM instagram_accounts ia
       WHERE ia.client_id = c.id
       LIMIT 1
    ) ig ON true
    LEFT JOIN latest l ON l.f_cliente_id = c.id
    LEFT JOIN membros mb ON mb.crm_user_id = l.f_author AND mb.conta_id = v_conta
    LEFT JOIN unread u ON u.f_cliente_id = c.id
   WHERE c.conta_id = v_conta
   ORDER BY l.f_created_at DESC NULLS LAST, c.nome;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_conversas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_conversas() TO authenticated;
