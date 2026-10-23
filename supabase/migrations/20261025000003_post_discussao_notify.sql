-- APLICAR DEPOIS do deploy do frontend; ver Rollout na spec.
--
-- Discussão da equipe dentro do post (3/3): post_discussion notifications, participant
-- triggers, the mention deep link and the one-off participant backfill.
-- Spec: docs/superpowers/specs/2026-10-22-discussao-do-post-design.md ("Notificações",
-- "Participantes e leitura (por post)", "Rollout").
--
-- Applied after the frontend deploy: the trigger also fires for anchored-thread comments, and
-- the old frontend can neither render post_discussion nor follow its deep link.
-- Rollback: drop the two post_comments triggers (and revert the frontend).

-- ---------------------------------------------------------------------
-- 1. One unread post_discussion per (user, post)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX notifications_post_discussion_unread_uq
  ON notifications (user_id, ((metadata->>'post_id')))
  WHERE type = 'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. AFTER INSERT on post_comments: participant rows + post_discussion
-- ---------------------------------------------------------------------
-- Acts only when auth.uid() is set (service-role inserts such as data-import notify nobody)
-- and the thread's conta_id is its post's conta_id.
--
-- Participant rows: the author (created following, last seen = this message, since they are
-- looking at the discussion; an existing row only has its marker advanced, never seguindo
-- re-enabled) and each mentioned current member (created following; an existing row is left
-- alone). Mentions are read from the content here: the mencoes rows do not exist yet when
-- this trigger fires.
--
-- Recipients: followers (row with seguindo) UNION the responsável without a row, minus the
-- author, minus users who left the workspace, and minus this message's mentioned users when
-- the message came through post_discussao_enviar (app.discussao_via_rpc = '1'): that RPC
-- runs sync_mentions in the same transaction, so they get a `mention` instead. On the legacy
-- path (createCommentThread) they are not excluded and may get both notices (accepted).
-- UNION, not UNION ALL: ON CONFLICT DO UPDATE raises if one statement hits a row twice.
CREATE OR REPLACE FUNCTION public.trg_post_comments_discussao_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_via_rpc     boolean := COALESCE(current_setting('app.discussao_via_rpc', true), '') = '1';
  v_thread      post_comment_threads;
  wp            workflow_posts;
  v_mencionados uuid[];
  v_author_name text;
  v_link        text;
  v_meta        jsonb;
BEGIN
  BEGIN
    IF v_uid IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_thread FROM post_comment_threads WHERE id = NEW.thread_id;
    SELECT * INTO wp FROM workflow_posts WHERE id = v_thread.post_id;
    IF wp.id IS NULL OR v_thread.conta_id IS DISTINCT FROM wp.conta_id THEN
      RETURN NEW;
    END IF;

    -- Mentioned users still in the workspace.
    SELECT COALESCE(array_agg(DISTINCT mb.crm_user_id), '{}'::uuid[])
      INTO v_mencionados
      FROM membros mb
     WHERE mb.id = ANY (post_discussao_membro_ids(NEW.content, wp.conta_id))
       AND mb.crm_user_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = wp.conta_id AND wm.user_id = mb.crm_user_id
       );

    INSERT INTO post_discussao_participantes AS pp (post_id, conta_id, user_id, last_seen_comment_id)
    VALUES (wp.id, wp.conta_id, NEW.author_id, NEW.id)
    ON CONFLICT (post_id, user_id) DO UPDATE
      SET last_seen_comment_id = GREATEST(pp.last_seen_comment_id, EXCLUDED.last_seen_comment_id),
          updated_at = now();

    INSERT INTO post_discussao_participantes (post_id, conta_id, user_id)
    SELECT wp.id, wp.conta_id, u
      FROM unnest(v_mencionados) AS u
     WHERE u <> NEW.author_id
    ON CONFLICT (post_id, user_id) DO NOTHING;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = NEW.author_id AND mb.conta_id = wp.conta_id
      LEFT JOIN profiles p ON p.id = NEW.author_id
     WHERE u.id = NEW.author_id
     LIMIT 1;
    v_author_name := COALESCE(v_author_name, 'Equipe');

    v_link := CASE WHEN wp.workflow_id IS NULL
      THEN '/entregas?post=' || wp.id || '&discussao=1'
      ELSE '/entregas?drawer=' || wp.workflow_id || '&post=' || wp.id || '&discussao=1'
    END;

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'post_id',      wp.id::text,
      'workflow_id',  wp.workflow_id,
      'post_titulo',  wp.titulo,
      'thread_field', v_thread.field,
      'quoted_text',  CASE WHEN v_thread.field = 'geral' THEN NULL ELSE v_thread.quoted_text END,
      'author_name',  v_author_name,
      'authors',      jsonb_build_array(v_author_name),
      'count',        1,
      -- Same token replacement as trg_notify_team_message (20261021103000 part b).
      'preview',      left(
        regexp_replace(
          NEW.content,
          '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
          '@\1',
          'g'
        ),
        280
      )
    ));

    INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
    SELECT wp.conta_id, d.user_id, 'post_discussion', v_meta, v_link
      FROM (
        SELECT pp.user_id
          FROM post_discussao_participantes pp
         WHERE pp.post_id = wp.id AND pp.seguindo
        UNION
        SELECT mb.crm_user_id
          FROM membros mb
         WHERE mb.id = wp.responsavel_id
           AND mb.conta_id = wp.conta_id
           AND mb.crm_user_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM post_discussao_participantes pp2
              WHERE pp2.post_id = wp.id AND pp2.user_id = mb.crm_user_id
           )
      ) d
     WHERE d.user_id <> NEW.author_id
       AND NOT (v_via_rpc AND d.user_id = ANY (v_mencionados))
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = wp.conta_id AND wm.user_id = d.user_id
       )
    ON CONFLICT (user_id, ((metadata->>'post_id')))
      WHERE type = 'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL
      DO UPDATE SET
        metadata = EXCLUDED.metadata || jsonb_build_object(
          'count', COALESCE((notifications.metadata->>'count')::int, 1) + 1,
          -- Latest author first, then earlier distinct authors, at most 3.
          'authors', (
            SELECT COALESCE(jsonb_agg(a.nome ORDER BY a.ord), '[]'::jsonb)
              FROM (
                SELECT x.nome, x.ord
                  FROM (
                    SELECT v_author_name AS nome, 0::bigint AS ord
                    UNION ALL
                    SELECT e.nome, e.ord
                      FROM jsonb_array_elements_text(
                             COALESCE(notifications.metadata->'authors', '[]'::jsonb)
                           ) WITH ORDINALITY AS e(nome, ord)
                     WHERE e.nome <> v_author_name
                  ) x
                 ORDER BY x.ord
                 LIMIT 3
              ) a
          )
        ),
        created_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_post_comments_discussao_insert failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. AFTER UPDATE OF content: participant rows for newly mentioned users
-- ---------------------------------------------------------------------
-- No post_discussion here: the new mention already produces a `mention` through
-- syncMentions in the frontend.
CREATE OR REPLACE FUNCTION public.trg_post_comments_discussao_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread post_comment_threads;
  wp       workflow_posts;
BEGIN
  BEGIN
    IF auth.uid() IS NULL OR NEW.content IS NOT DISTINCT FROM OLD.content THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_thread FROM post_comment_threads WHERE id = NEW.thread_id;
    SELECT * INTO wp FROM workflow_posts WHERE id = v_thread.post_id;
    IF wp.id IS NULL OR v_thread.conta_id IS DISTINCT FROM wp.conta_id THEN
      RETURN NEW;
    END IF;

    INSERT INTO post_discussao_participantes (post_id, conta_id, user_id)
    SELECT DISTINCT wp.id, wp.conta_id, mb.crm_user_id
      FROM membros mb
     WHERE mb.id = ANY (post_discussao_membro_ids(NEW.content, wp.conta_id))
       AND mb.id <> ALL (post_discussao_membro_ids(OLD.content, wp.conta_id))
       AND mb.crm_user_id IS NOT NULL
       AND mb.crm_user_id <> NEW.author_id
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = wp.conta_id AND wm.user_id = mb.crm_user_id
       )
    ON CONFLICT (post_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_post_comments_discussao_update failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER post_comments_discussao_insert
  AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_comments_discussao_insert();

CREATE TRIGGER post_comments_discussao_update
  AFTER UPDATE OF content ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_comments_discussao_update();

-- ---------------------------------------------------------------------
-- 4. trg_notify_mention: the post_comment branch opens the discussion
-- ---------------------------------------------------------------------
-- Copied from the latest definition (20260830000003_avulso_notifications_folders_views.sql);
-- only the post_comment branch's v_link changes.
CREATE OR REPLACE FUNCTION trg_notify_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name    text;
  v_context_title text;
  v_excerpt       text;
  v_workflow_id   bigint;
  v_post_id       bigint;
  v_task_id       bigint;
  v_link          text;
  v_metadata      jsonb;
  v_targets       uuid[];
BEGIN
  BEGIN
    -- Actor: prefer the membro record linked to the author's CRM login
    -- (matches the display name used elsewhere in the app); fall back to
    -- the auth.users profile for authors with no membro row yet.
    SELECT nome INTO v_actor_name
      FROM membros
     WHERE crm_user_id = NEW.author_id
       AND conta_id = NEW.conta_id
     LIMIT 1;

    IF v_actor_name IS NULL THEN
      SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_actor_name
        FROM auth.users
       WHERE id = NEW.author_id;
    END IF;

    IF NEW.host_type = 'tarefa' THEN
      SELECT titulo INTO v_context_title FROM tarefas WHERE id = NEW.host_id;
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_task_id := NEW.host_id;
      v_link := '/tarefas?tarefa=' || NEW.host_id;

    ELSIF NEW.host_type = 'workflow_post' THEN
      SELECT titulo, workflow_id INTO v_context_title, v_workflow_id
        FROM workflow_posts
       WHERE id = NEW.host_id;
      -- v_context_title (nao v_workflow_id) e o proxy de "host sumiu": titulo
      -- e NOT NULL DEFAULT '' em workflow_posts, entao so fica NULL quando o
      -- SELECT acima nao achou a linha -- workflow_id sozinho nao serve mais
      -- porque um avulso existente tem workflow_id NULL de forma legitima.
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_post_id := NEW.host_id;
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id
        ELSE '/entregas?drawer=' || v_workflow_id
      END;

    ELSIF NEW.host_type = 'post_comment' THEN
      -- Belt and suspenders: AND wp.conta_id = NEW.conta_id, in addition to
      -- the mencoes_tenant_all WITH CHECK guard above -- even if a malformed
      -- cross-workspace thread row somehow exists, this SECURITY DEFINER
      -- trigger must never read (and copy into a notification) a post title
      -- from a different workspace.
      SELECT wp.titulo, wp.workflow_id, wp.id, left(pc.content, 140)
        INTO v_context_title, v_workflow_id, v_post_id, v_excerpt
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
        JOIN workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = NEW.conta_id
       WHERE pc.id = NEW.host_id;
      -- Same proxy swap as the workflow_post branch above: v_context_title
      -- NULL means the JOIN found nothing, not "no workflow".
      IF v_context_title IS NULL THEN
        RETURN NEW;
      END IF;
      -- Discussão do post: the link opens the post with its discussion
      -- (20261025000003).
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id || '&discussao=1'
        ELSE '/entregas?drawer=' || v_workflow_id || '&post=' || v_post_id || '&discussao=1'
      END;
    END IF;

    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'actor_name',    v_actor_name,
      'host_type',     NEW.host_type,
      'host_id',       NEW.host_id,
      'context_title', v_context_title,
      'excerpt',       v_excerpt,
      'workflow_id',   v_workflow_id,
      'post_id',       v_post_id,
      'task_id',       v_task_id
    ));

    -- p_responsavel_id doubles here as "the mentioned membro": resolve_notification_targets
    -- appends that membro's crm_user_id (if set) to the target list, and with
    -- p_roles_filter NULL no extra role-based targets are added -- exactly
    -- the mentioned person, nobody else.
    v_targets := resolve_notification_targets(NEW.conta_id, NEW.mentioned_membro_id, NULL);

    -- p_exclude_actor = NEW.author_id silences self-mentions.
    PERFORM insert_notification_batch(NEW.conta_id, v_targets, 'mention', v_link, v_metadata, NEW.author_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_mention failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. One-off backfill: authors of existing active threads become participants
-- ---------------------------------------------------------------------
-- Per post: authors of comments in ACTIVE threads (resolved threads do not count) get a
-- following row whose marker is the post's current highest comment id, so nothing old shows
-- as unread. Active includes a general thread written in the window between the frontend
-- deploy and this migration. Only posts whose workspace exists, threads carrying their
-- post's conta_id, and authors who still exist and are members are written. Existing rows
-- are left alone. Returns the number of rows written.
CREATE OR REPLACE FUNCTION public.post_discussao_backfill_participantes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  INSERT INTO post_discussao_participantes (post_id, conta_id, user_id, seguindo, last_seen_comment_id)
  SELECT DISTINCT wp.id, wp.conta_id, pc.author_id, true, mx.max_id
    FROM post_comments pc
    JOIN post_comment_threads pct
      ON pct.id = pc.thread_id AND pct.status = 'active'
    JOIN workflow_posts wp
      ON wp.id = pct.post_id AND wp.conta_id = pct.conta_id
    JOIN workspaces w ON w.id = wp.conta_id
    JOIN auth.users u ON u.id = pc.author_id
    JOIN workspace_members wm ON wm.workspace_id = wp.conta_id AND wm.user_id = pc.author_id
    JOIN LATERAL (
      SELECT max(pc2.id) AS max_id
        FROM post_comments pc2
        JOIN post_comment_threads pct2 ON pct2.id = pc2.thread_id
       WHERE pct2.post_id = wp.id
    ) mx ON true
  ON CONFLICT (post_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.post_discussao_backfill_participantes()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.post_discussao_backfill_participantes();
