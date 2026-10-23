-- supabase/migrations/20261025000003_mensagens_media_notes.sql
-- Feedback em mídia na caixa de Mensagens (spec
-- docs/superpowers/specs/2026-10-22-feedback-em-midia-design.md, product
-- decision 2).
--
-- get_mensagens_feed, get_mensagens_unread e get_mensagens_conversas: corpos de
-- 20260830000003_avulso_notifications_folders_views.sql (a definição mais
-- recente dos três; as migrations posteriores que citam get_mensagens_* só
-- trocam grants ou comentam), assinaturas, RETURNS e grants idênticos. Só
-- ganham dois branches no UNION ALL, sempre com n.visibility = 'client':
--   * 'media_note'       item_id = nota,     action 'nota',          content = left(body, 280),
--                        is_workspace_user false, author_user_id NULL
--   * 'media_note_reply' item_id = resposta, action 'resposta_nota', content = left(body, 280),
--                        is_workspace_user = (author_kind = 'team'), author_user_id da resposta
-- Não lidas seguem as regras de sempre (created_at > mensagens_last_seen):
--   CRM  conta nota do cliente e resposta do cliente (is_workspace_user false)
--   Hub  conta resposta da equipe em nota do cliente
-- Nota interna e as respostas dela nunca geram linha, nem em não lidas.
--
-- Rollback: reaplicar as três funções de 20260830000003 (seção 8).

CREATE OR REPLACE FUNCTION get_mensagens_feed(
  p_conta_id       uuid        DEFAULT NULL,
  p_cliente_id     bigint      DEFAULT NULL,
  p_before         timestamptz DEFAULT NULL,
  p_limit          int         DEFAULT 50,
  p_before_source  text        DEFAULT NULL,
  p_before_item_id bigint      DEFAULT NULL
)
RETURNS TABLE (
  source            text,
  item_id           bigint,
  cliente_id        bigint,
  cliente_nome      text,
  post_id           bigint,
  workflow_id       bigint,
  post_titulo       text,
  action            text,
  content           text,
  is_workspace_user boolean,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN
      RAISE EXCEPTION 'No active workspace';
    END IF;
    IF p_conta_id IS NOT NULL AND p_conta_id <> v_conta THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  ELSE
    IF p_conta_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id required';
    END IF;
    v_conta := p_conta_id;
  END IF;

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, pa.id AS f_item_id,
           wp.cliente_id AS f_cliente_id, wp.id AS f_post_id,
           wp.workflow_id AS f_workflow_id, wp.titulo AS f_post_titulo,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
     WHERE wp.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', es.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.id,
           m.cliente_id, NULL::bigint, NULL::bigint, NULL::text,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
    UNION ALL
    -- Feedback em mídia: só notas visíveis ao cliente (nota de cliente é
    -- sempre client; a interna e suas respostas nunca entram).
    SELECT 'media_note', n.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'nota', left(n.body, 280),
           false, NULL::uuid, n.created_at
      FROM post_media_notes n
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE n.conta_id = v_conta AND n.visibility = 'client'
    UNION ALL
    SELECT 'media_note_reply', r.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'resposta_nota', left(r.body, 280),
           r.author_kind = 'team', r.author_user_id, r.created_at
      FROM post_media_note_replies r
      JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client'
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE r.conta_id = v_conta
  )
  SELECT f.f_source, f.f_item_id, f.f_cliente_id, c.nome,
         f.f_post_id, f.f_workflow_id, f.f_post_titulo,
         f.f_action, f.f_content, f.f_iwu,
         f.f_author, mb.nome, mb.avatar_url,
         f.f_created_at
    FROM feed f
    JOIN clientes c ON c.id = f.f_cliente_id
    LEFT JOIN membros mb ON mb.crm_user_id = f.f_author AND mb.conta_id = v_conta
   WHERE (p_cliente_id IS NULL OR f.f_cliente_id = p_cliente_id)
     -- Composite keyset cursor: now() is transaction-stable, so batch inserts
     -- can share the exact same created_at. A strict created_at-only cursor
     -- would silently skip sibling rows sitting on that boundary. Falling
     -- back to created_at-only when the source/item_id leg is missing keeps
     -- older callers correct-ish, but every caller in this codebase passes
     -- the full three-part cursor.
     AND (
       p_before IS NULL
       OR (
         CASE
           WHEN p_before_source IS NULL OR p_before_item_id IS NULL
             THEN f.f_created_at < p_before
           ELSE (f.f_created_at, f.f_source, f.f_item_id)
                < (p_before, p_before_source, p_before_item_id)
         END
       )
     )
   ORDER BY f.f_created_at DESC, f.f_source DESC, f.f_item_id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int, text, bigint)
  TO authenticated, service_role;

-- ============ UNREAD RPC ============
CREATE OR REPLACE FUNCTION get_mensagens_unread(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS TABLE (cliente_id bigint, unread_count bigint)
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

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT f.f_cliente_id, count(*)::bigint
      FROM (
        SELECT wp.cliente_id AS f_cliente_id, pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
         WHERE wp.conta_id = v_conta AND pa.is_workspace_user = false
        UNION ALL
        SELECT wp.cliente_id, es.created_at
          FROM post_edit_suggestions es
          JOIN workflow_posts wp ON wp.id = es.post_id
         WHERE es.conta_id = v_conta
        UNION ALL
        SELECT m.cliente_id, m.created_at
          FROM mensagens m
         WHERE m.conta_id = v_conta AND m.is_workspace_user = false
        UNION ALL
        -- notas do cliente e respostas do cliente nelas
        SELECT wp.cliente_id, n.created_at
          FROM post_media_notes n
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE n.conta_id = v_conta AND n.visibility = 'client'
        UNION ALL
        SELECT wp.cliente_id, r.created_at
          FROM post_media_note_replies r
          JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client'
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE r.conta_id = v_conta AND r.author_kind = 'client'
      ) f
     WHERE f.f_created_at > v_since
     GROUP BY f.f_cliente_id;
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = p_conta_id AND ls.cliente_id = p_cliente_id;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT p_cliente_id, count(*)::bigint
      FROM (
        SELECT pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
         WHERE wp.conta_id = p_conta_id AND wp.cliente_id = p_cliente_id
           AND pa.is_workspace_user = true
        UNION ALL
        SELECT m.created_at
          FROM mensagens m
         WHERE m.conta_id = p_conta_id AND m.cliente_id = p_cliente_id
           AND m.is_workspace_user = true
        UNION ALL
        -- respostas da equipe nas notas do cliente
        SELECT r.created_at
          FROM post_media_note_replies r
          JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client'
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE r.conta_id = p_conta_id AND wp.cliente_id = p_cliente_id
           AND r.author_kind = 'team'
      ) f
     WHERE f.f_created_at > v_since;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_unread(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_unread(uuid, bigint)
  TO authenticated, service_role;

-- ============ CONVERSAS RPC (v3, cliente_foto_url) ============
CREATE OR REPLACE FUNCTION get_mensagens_conversas()
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
    SELECT 'post_feedback'::text AS f_source, wp.cliente_id AS f_cliente_id,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
     WHERE wp.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', wp.cliente_id,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.cliente_id,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
    UNION ALL
    SELECT 'media_note', wp.cliente_id,
           'nota', left(n.body, 280),
           false, NULL::uuid, n.created_at
      FROM post_media_notes n
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE n.conta_id = v_conta AND n.visibility = 'client'
    UNION ALL
    SELECT 'media_note_reply', wp.cliente_id,
           'resposta_nota', left(r.body, 280),
           r.author_kind = 'team', r.author_user_id, r.created_at
      FROM post_media_note_replies r
      JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client'
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE r.conta_id = v_conta
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
