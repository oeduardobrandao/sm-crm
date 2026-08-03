-- supabase/migrations/20260803000006_mencoes.sql
-- @-mentions: mencoes table + notify pipeline + sync RPC + emailed_at groundwork.
-- Spec: docs/superpowers/specs/2026-08-03-at-mentions-implementation-plan.md (Task 1)
--
-- mencoes is a derived notification ledger, not a source of truth: rows are
-- (re)computed by sync_mentions() from the current content of a comment /
-- tarefa descricao / post body every time that content is saved, and pruned
-- by AFTER DELETE triggers when the host row itself disappears.

-- ============ TABLE ============
CREATE TABLE mencoes (
  id                   bigserial PRIMARY KEY,
  conta_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_type            text NOT NULL CHECK (host_type IN ('post_comment', 'tarefa', 'workflow_post')),
  host_id              bigint NOT NULL,
  mentioned_membro_id  bigint NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  author_id            uuid NOT NULL DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mencoes_uq UNIQUE (host_type, host_id, mentioned_membro_id)
);

CREATE INDEX mencoes_conta_idx    ON mencoes (conta_id);
CREATE INDEX mencoes_host_idx     ON mencoes (host_type, host_id);
CREATE INDEX mencoes_membro_idx   ON mencoes (mentioned_membro_id);

-- ============ RLS ============
ALTER TABLE mencoes ENABLE ROW LEVEL SECURITY;

-- WITH CHECK ties every pointer on the row to mencoes.conta_id (tarefas
-- pattern, 20260730000005): plain FKs alone would let a member of workspace A
-- write a mencoes row whose mentioned_membro_id / host_id point into
-- workspace B, because membros(id) and the three host tables all have their
-- own independent primary keys with no cross-workspace uniqueness. That
-- matters here specifically because resolve_notification_targets() (see
-- 20260430000001) reads membros BY ID with no conta_id check of its own --
-- it trusts the caller already scoped mentioned_membro_id to the right
-- workspace. A cross-tenant mentioned_membro_id would therefore leak a
-- notification payload (actor name, context title, excerpt) to a user in a
-- different workspace. Subqueries below qualify the outer row explicitly
-- (mencoes.mentioned_membro_id, mencoes.host_id, mencoes.conta_id) -- a bare
-- conta_id inside the EXISTS would resolve to the subquery's own table and
-- collapse the comparison into a tautology.
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
          -- tenant lives on its parent thread.
          SELECT 1 FROM public.post_comments pc
          JOIN public.post_comment_threads pct ON pct.id = pc.thread_id
          WHERE pc.id = mencoes.host_id
            AND pct.conta_id = mencoes.conta_id
        )
        ELSE false
      END
    )
  );

CREATE POLICY mencoes_service_role_bypass ON mencoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ notifications: add 'mention' to the type CHECK ============
-- Type list copied from the LATEST definition (20260730000006_task_assigned_notification.sql),
-- not the 20260430000001 original -- re-adding a stale list would break newer
-- inserts. This file (20260803000006) is now the latest definition; the next
-- migration to touch notifications_type_check must copy from here.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned',
    'mention'
  )
);

-- ============ Notify trigger ============
-- Mirrors the trg_notify_* shape from 20260430000001 / 20260730000006: whole
-- body wrapped in EXCEPTION WHEN OTHERS so a notification-side failure
-- (missing row, bad join, whatever) can NEVER roll back the mencoes INSERT
-- that triggered it -- the mention itself must always persist even if the
-- user never gets pinged.
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
      IF v_workflow_id IS NULL THEN
        RETURN NEW;
      END IF;
      v_post_id := NEW.host_id;
      v_link := '/entregas?drawer=' || v_workflow_id;

    ELSIF NEW.host_type = 'post_comment' THEN
      SELECT wp.titulo, wp.workflow_id, wp.id, left(pc.content, 140)
        INTO v_context_title, v_workflow_id, v_post_id, v_excerpt
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
        JOIN workflow_posts wp ON wp.id = pct.post_id
       WHERE pc.id = NEW.host_id;
      IF v_workflow_id IS NULL THEN
        RETURN NEW;
      END IF;
      v_link := '/entregas?drawer=' || v_workflow_id;
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

DROP TRIGGER IF EXISTS notify_mention ON mencoes;
CREATE TRIGGER notify_mention
  AFTER INSERT ON mencoes
  FOR EACH ROW EXECUTE FUNCTION trg_notify_mention();

-- ============ Cleanup triggers ============
-- mencoes has no single FK to its host (host_id is generic across three
-- tables, so it cannot be a real foreign key) -- these triggers are the
-- ON DELETE CASCADE substitute, one per host table.
CREATE OR REPLACE FUNCTION trg_cleanup_mencoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM mencoes WHERE host_type = TG_ARGV[0] AND host_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_mencoes_post_comment ON post_comments;
CREATE TRIGGER cleanup_mencoes_post_comment
  AFTER DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION trg_cleanup_mencoes('post_comment');

DROP TRIGGER IF EXISTS cleanup_mencoes_tarefa ON tarefas;
CREATE TRIGGER cleanup_mencoes_tarefa
  AFTER DELETE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION trg_cleanup_mencoes('tarefa');

DROP TRIGGER IF EXISTS cleanup_mencoes_workflow_post ON workflow_posts;
CREATE TRIGGER cleanup_mencoes_workflow_post
  AFTER DELETE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION trg_cleanup_mencoes('workflow_post');

-- ============ sync_mentions RPC ============
-- Called by the CRM (supabase.rpc) every time a comment / tarefa descricao /
-- post body is saved, with the full current set of mentioned membro ids. It
-- reconciles mencoes to that set: removes rows for membros no longer
-- mentioned, inserts rows for newly mentioned ones. Called even with an
-- empty array so edits that remove all mentions still clear stale rows.
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
  IF p_host_type NOT IN ('post_comment', 'tarefa', 'workflow_post') THEN
    RAISE EXCEPTION 'invalid host_type: %', p_host_type;
  END IF;

  CASE p_host_type
    WHEN 'tarefa' THEN
      SELECT conta_id INTO v_conta FROM tarefas WHERE id = p_host_id;
    WHEN 'workflow_post' THEN
      SELECT conta_id INTO v_conta FROM workflow_posts WHERE id = p_host_id;
    WHEN 'post_comment' THEN
      SELECT pct.conta_id INTO v_conta
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
       WHERE pc.id = p_host_id;
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

-- Supabase's default privileges grant new functions in public directly to
-- anon, authenticated and service_role (20260729000001 precedent) -- REVOKE
-- FROM PUBLIC alone would leave those intact, so every role is enumerated.
REVOKE ALL ON FUNCTION public.sync_mentions(text, bigint, bigint[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_mentions(text, bigint, bigint[])
  TO authenticated, service_role;

-- ============ Email groundwork ============
-- Written only by service_role (the future mention-email-cron edge function)
-- once it has sent the digest email for a notification -- intentionally NOT
-- added to the authenticated column grant on notifications (which stays
-- limited to read_at, dismissed_at from 20260430000001), since a client
-- marking its own notifications as "already emailed" would let the cron
-- skip sending them.
ALTER TABLE notifications ADD COLUMN emailed_at timestamptz;

CREATE INDEX idx_notifications_mention_unemailed
  ON notifications (created_at)
  WHERE type = 'mention' AND emailed_at IS NULL AND read_at IS NULL AND dismissed_at IS NULL;
