-- Tarefas: comentários da equipe (1/2).
-- Spec: docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md (section 2).
--
-- A flat thread per task. Comments are written ONLY through tarefa_comentario_enviar (SECURITY
-- DEFINER): it proves the tenant, parses @-mentions server-side and notifies the task's
-- participants with a deduped, in-app-only task_comment. Authors edit (conteudo only) and
-- delete their own comments directly under RLS; an edit re-syncs mentions through
-- sync_mentions, which gains the 'tarefa_comentario' host type here.
--
-- Sections: (1) table, RLS, grants, realtime; (2) mencoes host type + policy; (3) sync_mentions;
-- (4) mencoes cleanup trigger; (5) trg_notify_mention; (6) notification types + dedupe index;
-- (7) the RPC.

-- ---------------------------------------------------------------------
-- 1. tarefa_comentarios
-- ---------------------------------------------------------------------
CREATE TABLE public.tarefa_comentarios (
  id         bigserial PRIMARY KEY,
  conta_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tarefa_id  bigint NOT NULL,
  -- Nullable so deleting a user keeps the thread (the UI shows "Usuário removido").
  author_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conteudo   text NOT NULL CHECK (char_length(conteudo) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  -- Pins the comment to its task's own workspace (tarefas_id_conta_uq).
  CONSTRAINT tarefa_comentarios_tarefa_fk
    FOREIGN KEY (tarefa_id, conta_id) REFERENCES public.tarefas(id, conta_id) ON DELETE CASCADE
);

CREATE INDEX tarefa_comentarios_tarefa_created_idx
  ON public.tarefa_comentarios (tarefa_id, created_at);

-- edited_at is owned by the DB: authenticated holds UPDATE on conteudo only (column grants
-- check the SET list, not what a trigger writes).
CREATE OR REPLACE FUNCTION public.tarefa_comentarios_set_edited_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.conteudo IS DISTINCT FROM OLD.conteudo THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tarefa_comentarios_set_edited_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tarefa_comentarios_edited_at
  BEFORE UPDATE ON public.tarefa_comentarios
  FOR EACH ROW EXECUTE FUNCTION public.tarefa_comentarios_set_edited_at();

ALTER TABLE public.tarefa_comentarios ENABLE ROW LEVEL SECURITY;

-- No INSERT policy: the only write path is the RPC below.
CREATE POLICY tarefa_comentarios_select ON public.tarefa_comentarios
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));

-- Author only, in the caller's workspace. Owners/admins cannot edit or delete others'
-- comments, same as the post's general thread.
CREATE POLICY tarefa_comentarios_update_own ON public.tarefa_comentarios
  FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()) AND author_id = auth.uid())
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()) AND author_id = auth.uid());

CREATE POLICY tarefa_comentarios_delete_own ON public.tarefa_comentarios
  FOR DELETE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()) AND author_id = auth.uid());

CREATE POLICY tarefa_comentarios_service_role_bypass ON public.tarefa_comentarios
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hosted projects grant ALL on new public tables by default: take it away, then grant
-- exactly what the policies above need (precedent 20261025000002).
REVOKE ALL ON TABLE public.tarefa_comentarios FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.tarefa_comentarios TO authenticated;
GRANT UPDATE (conteudo) ON TABLE public.tarefa_comentarios TO authenticated;
GRANT ALL ON TABLE public.tarefa_comentarios TO service_role;
REVOKE ALL ON SEQUENCE public.tarefa_comentarios_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.tarefa_comentarios_id_seq TO service_role;

-- Realtime: the open thread listens to its task's comments.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'tarefa_comentarios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tarefa_comentarios;
    RAISE NOTICE 'added tarefa_comentarios to supabase_realtime';
  ELSE
    RAISE NOTICE 'tarefa_comentarios already in supabase_realtime';
  END IF;
END $$;

-- Pos-condicao: sem a tabela na publication o realtime silenciosamente nunca dispara
-- (padrao 20260728000001).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'tarefa_comentarios'
  ) THEN
    RAISE EXCEPTION 'tarefa_comentarios not in supabase_realtime publication';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. mencoes: host type 'tarefa_comentario'
-- ---------------------------------------------------------------------
-- 'tarefa' already means the task's DESCRIPTION; comments need their own host type.
-- mencoes_host_type_check is the auto-name of the inline CHECK in 20260803000006, the only
-- migration that defines it.
ALTER TABLE public.mencoes DROP CONSTRAINT mencoes_host_type_check;
ALTER TABLE public.mencoes ADD CONSTRAINT mencoes_host_type_check
  CHECK (host_type IN ('post_comment', 'tarefa', 'workflow_post', 'tarefa_comentario'));

-- Copied verbatim from 20260803000006_mencoes.sql (never redefined since), plus the
-- 'tarefa_comentario' arm. Without it the frontend edit path (UPDATE + syncMentions, run as
-- the caller) would fail the WITH CHECK through the ELSE false arm.
DROP POLICY mencoes_tenant_all ON public.mencoes;
CREATE POLICY mencoes_tenant_all ON mencoes
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.membros m
      WHERE m.id = mencoes.mentioned_membro_id
        AND m.conta_id = mencoes.conta_id
    )
    AND (
      CASE mencoes.host_type
        WHEN 'tarefa' THEN EXISTS (
          SELECT 1 FROM public.tarefas t
          WHERE t.id = mencoes.host_id
            AND t.conta_id = mencoes.conta_id
        )
        WHEN 'workflow_post' THEN EXISTS (
          SELECT 1 FROM public.workflow_posts wp
          WHERE wp.id = mencoes.host_id
            AND wp.conta_id = mencoes.conta_id
        )
        WHEN 'post_comment' THEN EXISTS (
          -- post_comments carries no conta_id of its own (20260423) -- the
          -- tenant lives on its parent thread. But post_comment_threads_insert
          -- (20260423) only WITH CHECKs conta_id, not that post_id belongs to
          -- that same workspace -- a thread row can legally exist with conta_id
          -- = A and post_id pointing at workspace B's post. Joining
          -- workflow_posts here and re-checking wp.conta_id closes that: a
          -- mention can only be created against a thread whose post is
          -- actually in the caller's workspace.
          SELECT 1 FROM public.post_comments pc
          JOIN public.post_comment_threads pct ON pct.id = pc.thread_id
          JOIN public.workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = pct.conta_id
          WHERE pc.id = mencoes.host_id
            AND pct.conta_id = mencoes.conta_id
        )
        -- tarefa_comentarios carries its own conta_id, pinned to its task's by the
        -- composite FK.
        WHEN 'tarefa_comentario' THEN EXISTS (
          SELECT 1 FROM public.tarefa_comentarios tc
          WHERE tc.id = mencoes.host_id
            AND tc.conta_id = mencoes.conta_id
        )
        ELSE false
      END
    )
  );

-- ---------------------------------------------------------------------
-- 3. sync_mentions: the new host type
-- ---------------------------------------------------------------------
-- Copied from 20260803000006_mencoes.sql (the only definition), plus 'tarefa_comentario' in
-- the guard and its CASE branch. CREATE OR REPLACE keeps the existing grants
-- (authenticated, service_role).
--
-- The comment branch requires authorship: the SELECT policy proves only that the caller
-- may READ the comment, and an edit must not let another member rewrite its mentions. The
-- RPC below calls this function as definer, where auth.uid() is still the caller, so the
-- same check holds there.
CREATE OR REPLACE FUNCTION public.sync_mentions(
  p_host_type   text,
  p_host_id     bigint,
  p_membro_ids  bigint[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER -- plpgsql's default; deliberate here. The caller's own RLS
                  -- on tarefas / workflow_posts / post_comments is what
                  -- proves they may see this host at all -- v_conta below
                  -- comes back NULL for a host outside the caller's
                  -- workspace, and mencoes' own RLS (mencoes_tenant_all)
                  -- still gates the INSERT/DELETE that follow.
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
BEGIN
  IF p_host_type NOT IN ('post_comment', 'tarefa', 'workflow_post', 'tarefa_comentario') THEN
    RAISE EXCEPTION 'invalid host_type: %', p_host_type;
  END IF;

  CASE p_host_type
    WHEN 'tarefa' THEN
      SELECT conta_id INTO v_conta FROM tarefas WHERE id = p_host_id;
    WHEN 'workflow_post' THEN
      SELECT conta_id INTO v_conta FROM workflow_posts WHERE id = p_host_id;
    WHEN 'post_comment' THEN
      -- Same JOIN + conta equality as mencoes_tenant_all's post_comment arm:
      -- post_comment_threads_insert (20260423) doesn't verify post_id is in
      -- the thread's own workspace, so resolving conta straight off the
      -- thread would let a malformed cross-workspace thread masquerade as
      -- caller A's host while its post actually belongs to workspace B.
      SELECT pct.conta_id INTO v_conta
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
        JOIN workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = pct.conta_id
       WHERE pc.id = p_host_id;
    WHEN 'tarefa_comentario' THEN
      -- In the caller's active workspace AND written by the caller. The explicit conta
      -- check matters on the definer path (the RPC), where RLS does not apply.
      SELECT tc.conta_id INTO v_conta
        FROM tarefa_comentarios tc
       WHERE tc.id = p_host_id
         AND tc.author_id = auth.uid()
         AND tc.conta_id IN (SELECT get_my_conta_id());
  END CASE;

  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'host not found';
  END IF;

  DELETE FROM mencoes
   WHERE host_type = p_host_type
     AND host_id = p_host_id
     AND mentioned_membro_id <> ALL (COALESCE(p_membro_ids, '{}'::bigint[]));

  -- p_membro_ids comes from parsing @-mention tokens out of free-form text
  -- (comment bodies, tarefa descricao, post content) -- a hand-typed,
  -- stale (membro since deleted), or cross-tenant id is just malformed
  -- user input, not a security event to fail loudly on. Without the JOIN
  -- below, one bad id in the array would make the whole multi-row INSERT's
  -- RLS WITH CHECK (mencoes_tenant_all's membros EXISTS guard) fail and
  -- abort the entire statement -- silently dropping every OTHER, valid
  -- mention in the same save. Scoping the JOIN to mb.conta_id = v_conta
  -- filters out invalid/foreign ids before they ever reach the INSERT, so
  -- a single bad token degrades gracefully instead of poisoning the batch.
  -- mencoes_tenant_all's WITH CHECK still runs on every row that DOES pass
  -- this filter -- belt-and-suspenders, not a replacement for the RLS guard.
  INSERT INTO mencoes (conta_id, host_type, host_id, mentioned_membro_id)
  SELECT v_conta, p_host_type, p_host_id, s.m
    FROM (SELECT DISTINCT unnest(p_membro_ids) AS m) s
    JOIN membros mb ON mb.id = s.m AND mb.conta_id = v_conta
  ON CONFLICT ON CONSTRAINT mencoes_uq DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. mencoes cleanup when a comment is deleted (directly or by the task cascade)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS cleanup_mencoes_tarefa_comentario ON public.tarefa_comentarios;
CREATE TRIGGER cleanup_mencoes_tarefa_comentario
  AFTER DELETE ON public.tarefa_comentarios
  FOR EACH ROW EXECUTE FUNCTION trg_cleanup_mencoes('tarefa_comentario');

-- ---------------------------------------------------------------------
-- 5. trg_notify_mention: the tarefa_comentario branch
-- ---------------------------------------------------------------------
-- Copied whole from the latest definition (20261025000003_post_discussao_notify.sql); only
-- the 'tarefa_comentario' branch is new. It uses the keys the mention card already reads
-- (context_title, excerpt, task_id) and opens the task with its comments.
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

    ELSIF NEW.host_type = 'tarefa_comentario' THEN
      -- Comentário de tarefa (20261103000001). Both the comment and its task are read with
      -- conta_id = NEW.conta_id, so this definer trigger never copies another workspace's
      -- title or text into a notification.
      SELECT t.titulo, t.id, left(tc.conteudo, 140)
        INTO v_context_title, v_task_id, v_excerpt
        FROM tarefa_comentarios tc
        JOIN tarefas t ON t.id = tc.tarefa_id AND t.conta_id = NEW.conta_id
       WHERE tc.id = NEW.host_id
         AND tc.conta_id = NEW.conta_id;
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_link := '/tarefas?tarefa=' || v_task_id || '&comentarios=1';
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
-- 6. Notification type lists: + 'task_comment' (in-app only)
-- ---------------------------------------------------------------------
-- ATENCAO: listas copiadas das definicoes MAIS RECENTES no momento de escrever
-- (notifications_type_check e notification_inapp_prefs_type_check:
-- 20261031000003_linha_editorial_hub_notifications.sql) e que apenas ACRESCENTAM
-- 'task_comment'. notification_email_prefs_type_check e claim_notification_emails NAO mudam:
-- task_comment e so in-app, como post_discussion e team_message. Este arquivo passa a ser a
-- definicao mais recente das duas listas: a proxima migration copia DAQUI.
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
    'post_discussion',
    'linha_editorial_aprovada', 'linha_editorial_ajustes',
    'task_comment'
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
    'linha_editorial_aprovada','linha_editorial_ajustes',
    'task_comment',
    '__all__'
  ));

-- One unread task_comment per (user, task); later comments update it (count, authors).
CREATE UNIQUE INDEX notifications_task_comment_unread_uq
  ON notifications (user_id, ((metadata->>'task_id')))
  WHERE type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL;

-- ---------------------------------------------------------------------
-- 7. tarefa_comentario_enviar
-- ---------------------------------------------------------------------
-- The task must belong to the caller's active workspace and the caller must be in its
-- workspace_members (post_discussao_post_do_chamador shape, 20261025000002); otherwise
-- tarefa_not_found (P0002), the same answer for "missing" and "not yours". That check is the
-- tenant proof for everything after it: sync_mentions runs here as definer, without RLS.
--
-- Mentions are parsed from the content (post_discussao_membro_ids: same token regexp, bigint
-- overflow guard, scoped to the task's workspace); the client sends no list. The mention
-- sync runs in this transaction: if it fails, nothing is written.
--
-- task_comment recipients: the assignee, the creator and every earlier commenter, minus the
-- author, minus the users behind the membros this comment actually mentions (they get a
-- `mention`), minus anyone not in the task's workspace. The workspace_members filter is also
-- what keeps a foreign responsavel_id (single-column FK, service-role writes) from leaking:
-- resolve_notification_targets reads membros by id alone. UNION, not UNION ALL: ON CONFLICT
-- DO UPDATE raises if one statement hits a row twice. A plain INSERT (insert_notification_batch)
-- would raise unique_violation on the second unread comment, hence the hand-written upsert,
-- adapted from trg_post_comments_discussao_insert (20261025000003). The notification block
-- swallows its own errors: a notification failure never rolls back the comment.
CREATE OR REPLACE FUNCTION public.tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text)
RETURNS public.tarefa_comentarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  t             tarefas;
  v_conteudo    text;
  v_row         tarefa_comentarios;
  v_mencionados uuid[];
  v_author_name text;
  v_meta        jsonb;
BEGIN
  SELECT * INTO t FROM tarefas WHERE id = p_tarefa_id;
  IF v_uid IS NULL
     OR t.id IS NULL
     OR t.conta_id IS DISTINCT FROM (SELECT get_my_conta_id())
     OR NOT EXISTS (
       SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = t.conta_id AND wm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'tarefa_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_conteudo := COALESCE(btrim(p_conteudo), '');
  IF v_conteudo = '' THEN
    RAISE EXCEPTION 'content_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_conteudo) > 4000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
  VALUES (t.conta_id, t.id, v_uid, v_conteudo)
  RETURNING * INTO v_row;

  PERFORM sync_mentions('tarefa_comentario', v_row.id,
                        post_discussao_membro_ids(v_conteudo, t.conta_id));

  BEGIN
    -- Users behind the membros mencoes actually kept for this comment.
    SELECT COALESCE(array_agg(DISTINCT mb.crm_user_id), '{}'::uuid[])
      INTO v_mencionados
      FROM mencoes me
      JOIN membros mb ON mb.id = me.mentioned_membro_id AND mb.conta_id = t.conta_id
     WHERE me.host_type = 'tarefa_comentario'
       AND me.host_id = v_row.id
       AND mb.crm_user_id IS NOT NULL;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = v_uid AND mb.conta_id = t.conta_id
      LEFT JOIN profiles p ON p.id = v_uid
     WHERE u.id = v_uid
     LIMIT 1;
    v_author_name := COALESCE(v_author_name, 'Equipe');

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'task_id',     t.id::text,
      'task_title',  t.titulo,
      'author_name', v_author_name,
      'authors',     jsonb_build_array(v_author_name),
      'count',       1,
      -- Same token replacement as trg_post_comments_discussao_insert (20261025000003).
      'preview',     left(
        regexp_replace(
          v_conteudo,
          '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
          '@\1',
          'g'
        ),
        280
      )
    ));

    INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
    SELECT t.conta_id, d.user_id, 'task_comment', v_meta,
           '/tarefas?tarefa=' || t.id || '&comentarios=1'
      FROM (
        SELECT unnest(resolve_notification_targets(t.conta_id, t.responsavel_id, NULL)) AS user_id
        UNION
        SELECT t.user_id
        UNION
        SELECT tc.author_id
          FROM tarefa_comentarios tc
         WHERE tc.tarefa_id = t.id
           AND tc.conta_id = t.conta_id
           AND tc.id <> v_row.id
           AND tc.author_id IS NOT NULL
      ) d
     WHERE d.user_id IS NOT NULL
       AND d.user_id <> v_uid
       AND d.user_id <> ALL (v_mencionados)
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = t.conta_id AND wm.user_id = d.user_id
       )
    ON CONFLICT (user_id, ((metadata->>'task_id')))
      WHERE type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL
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
    RAISE WARNING 'tarefa_comentario_enviar notification failed: % %', SQLERRM, SQLSTATE;
  END;

  RETURN v_row;
END;
$$;

-- Supabase's default privileges grant new functions to anon/authenticated/service_role
-- directly; REVOKE FROM PUBLIC alone would leave those grants in place.
REVOKE ALL ON FUNCTION public.tarefa_comentario_enviar(bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_comentario_enviar(bigint, text) TO authenticated;
