-- Discussão da equipe dentro do post (2/3): participants, RPCs, realtime and the
-- post_discussion notification type.
-- Spec: docs/superpowers/specs/2026-10-22-discussao-do-post-design.md ("Participantes e
-- leitura (por post)", "RPCs", "Notificações").
--
-- Participation and read state are PER POST, not per thread: the discussion is one
-- timeline (general thread + anchored-thread cards), so following, unread counts and
-- notices cover every thread of the post.
--
-- Every RPC is SECURITY DEFINER and is itself the tenant proof: it loads the post, requires
-- the post's conta_id to be the caller's active workspace and the caller to be in
-- workspace_members of it, and requires any thread it touches to carry the post's conta_id.

-- ---------------------------------------------------------------------
-- 1. post_discussao_participantes
-- ---------------------------------------------------------------------
CREATE TABLE public.post_discussao_participantes (
  post_id              bigint NOT NULL REFERENCES public.workflow_posts(id) ON DELETE CASCADE,
  conta_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seguindo             boolean NOT NULL DEFAULT true,
  -- Watermark over post_comments.id of ANY thread of the post (an id, not a timestamp).
  last_seen_comment_id bigint NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_discussao_participantes_user_idx
  ON public.post_discussao_participantes (user_id, conta_id);

ALTER TABLE public.post_discussao_participantes ENABLE ROW LEVEL SECURITY;

-- Rows are written only by the RPCs below and by the comment trigger (next migration),
-- all SECURITY DEFINER. Hosted projects grant ALL on new public tables by default, so
-- take the writes away explicitly.
REVOKE ALL ON TABLE public.post_discussao_participantes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_discussao_participantes TO authenticated;
GRANT ALL ON TABLE public.post_discussao_participantes TO service_role;

CREATE POLICY post_discussao_participantes_own_select ON public.post_discussao_participantes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND conta_id IN (SELECT public.get_my_conta_id()));

-- ---------------------------------------------------------------------
-- 2. Private helpers (no EXECUTE for any API role)
-- ---------------------------------------------------------------------
-- The post, if it belongs to the caller's active workspace and the caller is a member of
-- it; otherwise post_not_found (P0002), the same answer for "missing" and "not yours".
CREATE OR REPLACE FUNCTION public.post_discussao_post_do_chamador(p_post_id bigint)
RETURNS public.workflow_posts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  wp    workflow_posts;
BEGIN
  SELECT * INTO wp FROM workflow_posts WHERE id = p_post_id;
  IF v_uid IS NULL
     OR wp.id IS NULL
     OR wp.conta_id IS DISTINCT FROM (SELECT get_my_conta_id())
     OR NOT EXISTS (
       SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = wp.conta_id AND wm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN wp;
END;
$$;

-- membros ids of the "@[Nome](membro:<id>)" tokens in p_content, restricted to the given
-- workspace. Invalid, oversized, foreign or deleted ids are dropped silently. The comment
-- trigger of the next migration reuses it.
CREATE OR REPLACE FUNCTION public.post_discussao_membro_ids(p_content text, p_conta_id uuid)
RETURNS bigint[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT mb.id), '{}'::bigint[])
    FROM regexp_matches(COALESCE(p_content, ''), '\]\(membro:([0-9]+)\)', 'g') AS m(g)
    JOIN membros mb
      -- CASE, not an AND'ed length check: a qual's evaluation order is not guaranteed,
      -- and a 19+ digit token must be ignored, not overflow the cast.
      ON mb.id = CASE WHEN length(m.g[1]) <= 18 THEN m.g[1]::bigint END
     AND mb.conta_id = p_conta_id;
$$;

REVOKE ALL ON FUNCTION public.post_discussao_post_do_chamador(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_discussao_membro_ids(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. post_discussao_enviar
-- ---------------------------------------------------------------------
-- Without p_thread_id: get-or-create the post's general thread and write there.
-- With p_thread_id: reply in an anchored thread, which must be of this post, carry the
-- post's conta_id and be active. sync_mentions is SECURITY INVOKER by design; called from
-- here it no longer gets RLS as its tenant proof, so the checks above are that proof.
-- The mention sync runs in this same transaction: if it fails, nothing is written.
CREATE OR REPLACE FUNCTION public.post_discussao_enviar(
  p_post_id   bigint,
  p_content   text,
  p_thread_id bigint DEFAULT NULL
)
RETURNS public.post_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  wp        workflow_posts;
  v_thread  post_comment_threads;
  v_content text;
  v_comment post_comments;
BEGIN
  wp := post_discussao_post_do_chamador(p_post_id);

  v_content := COALESCE(btrim(p_content), '');
  IF v_content = '' THEN
    RAISE EXCEPTION 'content_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;

  IF p_thread_id IS NULL THEN
    -- Two concurrent first messages: the partial unique index makes the loser a no-op.
    INSERT INTO post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
    VALUES (p_post_id, wp.conta_id, '', v_uid, 'geral')
    ON CONFLICT (post_id) WHERE field = 'geral' DO NOTHING;

    SELECT * INTO v_thread
      FROM post_comment_threads
     WHERE post_id = p_post_id AND field = 'geral';
  ELSE
    SELECT * INTO v_thread
      FROM post_comment_threads
     WHERE id = p_thread_id;
  END IF;

  IF v_thread.id IS NULL
     OR v_thread.post_id <> p_post_id
     OR v_thread.conta_id <> wp.conta_id THEN
    RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.status <> 'active' THEN
    RAISE EXCEPTION 'thread_resolved' USING ERRCODE = '22023';
  END IF;

  -- Transaction-scoped flag the comment trigger (next migration) reads to know the insert
  -- came through this RPC. Cleared right after the INSERT so nothing later in the same
  -- transaction inherits it.
  PERFORM set_config('app.discussao_via_rpc', '1', true);
  INSERT INTO post_comments (thread_id, author_id, content)
  VALUES (v_thread.id, v_uid, v_content)
  RETURNING * INTO v_comment;
  PERFORM set_config('app.discussao_via_rpc', '', true);

  PERFORM sync_mentions('post_comment', v_comment.id,
                        post_discussao_membro_ids(v_content, wp.conta_id));

  RETURN v_comment;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. post_discussao_marcar_lido
-- ---------------------------------------------------------------------
-- Any workspace member may create their row here (the frontend calls it for participants).
CREATE OR REPLACE FUNCTION public.post_discussao_marcar_lido(p_post_id bigint, p_comment_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wp workflow_posts;
BEGIN
  wp := post_discussao_post_do_chamador(p_post_id);

  IF NOT EXISTS (
    SELECT 1
      FROM post_comments pc
      JOIN post_comment_threads pct ON pct.id = pc.thread_id
     WHERE pc.id = p_comment_id
       AND pct.post_id = p_post_id
       AND pct.conta_id = wp.conta_id
  ) THEN
    RAISE EXCEPTION 'comment_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO post_discussao_participantes AS pp (post_id, conta_id, user_id, last_seen_comment_id)
  VALUES (p_post_id, wp.conta_id, auth.uid(), p_comment_id)
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET last_seen_comment_id = GREATEST(pp.last_seen_comment_id, EXCLUDED.last_seen_comment_id),
        updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------
-- 5. post_discussao_seguir
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_discussao_seguir(p_post_id bigint, p_seguir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wp workflow_posts;
BEGIN
  wp := post_discussao_post_do_chamador(p_post_id);

  INSERT INTO post_discussao_participantes AS pp (post_id, conta_id, user_id, seguindo)
  VALUES (p_post_id, wp.conta_id, auth.uid(), COALESCE(p_seguir, false))
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET seguindo = EXCLUDED.seguindo,
        updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------
-- 6. get_post_discussao_participacao
-- ---------------------------------------------------------------------
-- Always one row. With a row: its values, implicito = false. Without a row: the post's
-- responsável (workflow_posts.responsavel_id -> membros.crm_user_id, same conta) is an
-- implicit follower (true, 0, true); anyone else is (false, 0, false).
CREATE OR REPLACE FUNCTION public.get_post_discussao_participacao(p_post_id bigint)
RETURNS TABLE (seguindo boolean, last_seen_comment_id bigint, implicito boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  wp    workflow_posts;
BEGIN
  wp := post_discussao_post_do_chamador(p_post_id);

  RETURN QUERY
    SELECT pp.seguindo, pp.last_seen_comment_id, false
      FROM post_discussao_participantes pp
     WHERE pp.post_id = p_post_id AND pp.user_id = v_uid;
  IF FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM membros mb
     WHERE mb.id = wp.responsavel_id
       AND mb.conta_id = wp.conta_id
       AND mb.crm_user_id = v_uid
  ) THEN
    RETURN QUERY SELECT true, 0::bigint, true;
  ELSE
    RETURN QUERY SELECT false, 0::bigint, false;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. get_post_discussao_nao_lidas
-- ---------------------------------------------------------------------
-- Per post of the caller's workspace, selected by post ids and/or fluxo ids (the board
-- knows fluxos, not post ids); both NULL returns nothing. Only posts with total > 0.
--   total     = comments in ANY thread of the post;
--   nao_lidas = of those, in the general thread or an active passage thread (what the
--               editor marks as new), id > last_seen_comment_id and written by someone
--               else, only for participants who follow (row with seguindo, or the
--               responsável without a row, marker 0). Everyone else gets 0.
-- A caller with no active workspace membership (removed member) gets no rows.
CREATE OR REPLACE FUNCTION public.get_post_discussao_nao_lidas(
  p_post_ids     bigint[] DEFAULT NULL,
  p_workflow_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (post_id bigint, workflow_id bigint, total int, nao_lidas int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid, get_my_conta_id() AS conta
  ),
  posts AS (
    SELECT wp.id, wp.workflow_id, wp.conta_id, wp.responsavel_id
      FROM workflow_posts wp, me
     WHERE me.uid IS NOT NULL
       AND wp.conta_id = me.conta
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = me.conta AND wm.user_id = me.uid
       )
       AND (   (p_post_ids IS NOT NULL AND wp.id = ANY (p_post_ids))
            OR (p_workflow_ids IS NOT NULL AND wp.workflow_id = ANY (p_workflow_ids)))
  ),
  estado AS (
    SELECT p.id AS post_id,
           CASE
             WHEN pp.user_id IS NOT NULL THEN pp.seguindo
             ELSE EXISTS (
               SELECT 1 FROM membros mb
                WHERE mb.id = p.responsavel_id
                  AND mb.conta_id = p.conta_id
                  AND mb.crm_user_id = me.uid)
           END AS segue,
           COALESCE(pp.last_seen_comment_id, 0) AS marca
      FROM posts p
      CROSS JOIN me
      LEFT JOIN post_discussao_participantes pp
        ON pp.post_id = p.id AND pp.user_id = me.uid
  )
  SELECT p.id,
         p.workflow_id,
         count(pc.id)::int,
         (count(pc.id) FILTER (
            WHERE e.segue AND pct.status = 'active'
              AND pc.id > e.marca AND pc.author_id <> me.uid))::int
    FROM posts p
    CROSS JOIN me
    JOIN estado e ON e.post_id = p.id
    JOIN post_comment_threads pct ON pct.post_id = p.id AND pct.conta_id = p.conta_id
    JOIN post_comments pc ON pc.thread_id = pct.id
   GROUP BY p.id, p.workflow_id;
$$;

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_discussao_enviar(bigint, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_discussao_enviar(bigint, text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.post_discussao_marcar_lido(bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_discussao_marcar_lido(bigint, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.post_discussao_seguir(bigint, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_discussao_seguir(bigint, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.get_post_discussao_participacao(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_post_discussao_participacao(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.get_post_discussao_nao_lidas(bigint[], bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_post_discussao_nao_lidas(bigint[], bigint[]) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Realtime: the open discussion listens to its post's threads and comments
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['post_comment_threads', 'post_comments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'added % to supabase_realtime', t;
    ELSE
      RAISE NOTICE '% already in supabase_realtime', t;
    END IF;
  END LOOP;
END $$;

-- Pos-condicao: sem a tabela na publication o realtime silenciosamente nunca
-- dispara (padrao 20260728000001).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['post_comment_threads', 'post_comments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = t
    ) THEN
      RAISE EXCEPTION '% not in supabase_realtime publication', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 10. Notification type lists: + 'post_discussion'
-- ---------------------------------------------------------------------
-- ATENCAO: listas copiadas das definicoes MAIS RECENTES no momento de escrever
-- (notifications: 20261021100000_equipe_chat_core.sql; notification_inapp_prefs:
-- 20261021103000_team_message_inapp_pref.sql, com '__all__') e que apenas ACRESCENTAM
-- 'post_discussion'. Este arquivo passa a ser a definicao mais recente: a proxima
-- migration copia DAQUI.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion'
  )
);

alter table notification_inapp_prefs
  drop constraint notification_inapp_prefs_type_check;
alter table notification_inapp_prefs
  add constraint notification_inapp_prefs_type_check check (type in (
    'post_approved','post_correction','post_message','post_edit_suggestion',
    'idea_submitted','briefing_answered','step_activated','step_completed',
    'post_assigned','task_assigned','workflow_completed','deadline_approaching',
    'invite_accepted','member_role_changed','member_removed','client_message',
    'mention','post_status_automation','instagram_connected_by_client',
    'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
    'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
    'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion',
    '__all__'
  ));
