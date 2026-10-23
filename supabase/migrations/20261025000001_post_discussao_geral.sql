-- Discussão da equipe dentro do post (1/3): the general thread and its database guarantees.
-- Spec: docs/superpowers/specs/2026-10-22-discussao-do-post-design.md ("Modelo de dados",
-- "Garantias no banco").
--
-- post_comment_threads.field gains 'geral': one thread per post, not anchored to any text,
-- never resolved, reopened or deleted while its post exists. It is only ever created by
-- the post_discussao_enviar RPC (SECURITY DEFINER, next migration).
--
-- The 20260423 policies only check the thread's conta_id. For the general thread that
-- becomes a database guarantee here, without changing the behaviour of anchored threads:
--   * authenticated cannot INSERT a 'geral' thread directly;
--   * a 'geral' thread's field/status/post_id/conta_id never change (trigger);
--   * a 'geral' thread cannot be deleted while its post exists (trigger; the post's
--     ON DELETE CASCADE still passes);
--   * post_comments.author_id must be the caller on INSERT (every thread);
--   * in a 'geral' thread only the author updates or deletes a message.

-- ---------------------------------------------------------------------
-- 1. field CHECK: add 'geral'
-- ---------------------------------------------------------------------
-- 20260925000020 declared the field CHECK inline, so its name is auto-generated
-- (post_comment_threads_field_check locally). Find it by its single column instead of
-- trusting the name, and insist on exactly one match.
DO $$
DECLARE
  v_names text[];
BEGIN
  SELECT array_agg(c.conname)
    INTO v_names
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'field'
   WHERE c.conrelid = 'public.post_comment_threads'::regclass
     AND c.contype = 'c'
     AND c.conkey = ARRAY[a.attnum];

  IF coalesce(array_length(v_names, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one single-column CHECK on post_comment_threads.field, found %',
      coalesce(array_length(v_names, 1), 0);
  END IF;

  EXECUTE format('ALTER TABLE public.post_comment_threads DROP CONSTRAINT %I', v_names[1]);
END $$;

ALTER TABLE public.post_comment_threads
  ADD CONSTRAINT post_comment_threads_field_check
    CHECK (field IN ('conteudo', 'ig_caption', 'geral'));

-- ---------------------------------------------------------------------
-- 2. anchor CHECK: third branch for 'geral' (first two copied verbatim)
-- ---------------------------------------------------------------------
ALTER TABLE public.post_comment_threads
  DROP CONSTRAINT post_comment_threads_anchor_chk;

ALTER TABLE public.post_comment_threads
  ADD CONSTRAINT post_comment_threads_anchor_chk CHECK (
    (field = 'conteudo' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned)
    OR (field = 'ig_caption' AND (
      (orphaned AND anchor_start IS NULL AND anchor_end IS NULL)
      OR (NOT orphaned AND anchor_start IS NOT NULL AND anchor_end IS NOT NULL
          AND anchor_start >= 0 AND anchor_end > anchor_start)
    ))
    OR (field = 'geral' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned
        AND quoted_text = '' AND status = 'active')
  );

-- ---------------------------------------------------------------------
-- 3. One general thread per post (the RPC's INSERT ... ON CONFLICT target)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX post_comment_threads_geral_uq
  ON public.post_comment_threads (post_id)
  WHERE field = 'geral';

-- ---------------------------------------------------------------------
-- 4. Restrictive policies
-- ---------------------------------------------------------------------
-- The general thread is born only through the SECURITY DEFINER RPC.
CREATE POLICY post_comment_threads_no_geral_insert ON public.post_comment_threads
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (field <> 'geral');

-- Every message, in any thread, is written as the caller. The CRM already writes
-- profile.id (= auth.uid()); data-import uses the service role and is unaffected.
CREATE POLICY post_comments_author_is_self ON public.post_comments
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- In the general thread only the author edits or deletes a message. Anchored threads keep
-- the broad 20260423 rule (non-goal). With no WITH CHECK clause the UPDATE policy reuses
-- USING for the new row, so another user's message cannot be moved into a general thread.
CREATE POLICY post_comments_geral_author_update ON public.post_comments
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR thread_id NOT IN (SELECT id FROM public.post_comment_threads WHERE field = 'geral')
  );

CREATE POLICY post_comments_geral_author_delete ON public.post_comments
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR thread_id NOT IN (SELECT id FROM public.post_comment_threads WHERE field = 'geral')
  );

-- ---------------------------------------------------------------------
-- 5. Guard triggers (apply to every role, service role included)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_post_comment_threads_geral_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.field = 'geral' OR NEW.field = 'geral' THEN
    IF NEW.field IS DISTINCT FROM OLD.field
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.conta_id IS DISTINCT FROM OLD.conta_id THEN
      RAISE EXCEPTION 'geral_thread_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER so the EXISTS below sees workflow_posts unfiltered by the caller's RLS.
-- The post's ON DELETE CASCADE runs after the parent row is gone, so it passes.
CREATE OR REPLACE FUNCTION public.trg_post_comment_threads_geral_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.field = 'geral'
     AND EXISTS (SELECT 1 FROM workflow_posts WHERE id = OLD.post_id) THEN
    RAISE EXCEPTION 'geral_thread_undeletable' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER post_comment_threads_geral_guard_update
  BEFORE UPDATE ON public.post_comment_threads
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_comment_threads_geral_guard_update();

CREATE TRIGGER post_comment_threads_geral_guard_delete
  BEFORE DELETE ON public.post_comment_threads
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_comment_threads_geral_guard_delete();
