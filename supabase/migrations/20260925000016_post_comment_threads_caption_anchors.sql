-- Comment threads on the Instagram caption (workflow_posts.ig_caption).
-- The caption is a plain textarea, so unlike TipTap threads (anchored by a mark
-- inside conteudo) these carry their anchor in the row: UTF-16 code-unit offsets.

ALTER TABLE public.post_comment_threads
  ADD COLUMN field text NOT NULL DEFAULT 'conteudo'
    CHECK (field IN ('conteudo', 'ig_caption')),
  ADD COLUMN anchor_start int,
  ADD COLUMN anchor_end int,
  ADD COLUMN orphaned boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT post_comment_threads_anchor_chk CHECK (
    (field = 'conteudo' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned)
    OR (field = 'ig_caption' AND (
      (orphaned AND anchor_start IS NULL AND anchor_end IS NULL)
      OR (NOT orphaned AND anchor_start IS NOT NULL AND anchor_end IS NOT NULL
          AND anchor_start >= 0 AND anchor_end > anchor_start)
    ))
  );

-- Saves the caption and re-anchors its comment threads in ONE transaction, so the
-- text and the offsets stored in the DB can never disagree. SECURITY INVOKER:
-- workflow_posts / post_comment_threads RLS (conta_id) applies to the caller.
-- p_anchors: [{ id, anchor_start, anchor_end, orphaned, quoted_text? }, ...].
-- Only threads of THIS post with field = 'ig_caption' are touched.
-- A non-orphaned anchor must fit inside the caption saved in the same call, measured
-- in UTF-16 code units (JS string indices): astral-plane characters (emoji) count 2,
-- which char_length would get wrong. A violation raises and rolls the whole call back.
CREATE OR REPLACE FUNCTION public.save_ig_caption(
  p_post_id bigint,
  p_caption text,
  p_anchors jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  v_len int;
BEGIN
  UPDATE workflow_posts SET ig_caption = p_caption WHERE id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_len := char_length(COALESCE(p_caption, ''))
    + (SELECT count(*) FROM regexp_matches(COALESCE(p_caption, ''), '[\U00010000-\U0010FFFF]', 'g'));

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_anchors, '[]'::jsonb)) LOOP
    IF NOT (a->>'orphaned')::boolean AND (a->>'anchor_end')::int > v_len THEN
      RAISE EXCEPTION 'anchor_out_of_range' USING ERRCODE = '22023';
    END IF;

    UPDATE post_comment_threads SET
      anchor_start = CASE WHEN (a->>'orphaned')::boolean THEN NULL ELSE (a->>'anchor_start')::int END,
      anchor_end   = CASE WHEN (a->>'orphaned')::boolean THEN NULL ELSE (a->>'anchor_end')::int END,
      orphaned     = (a->>'orphaned')::boolean,
      quoted_text  = COALESCE(a->>'quoted_text', quoted_text)
    WHERE id = (a->>'id')::bigint
      AND post_id = p_post_id
      AND field = 'ig_caption';
  END LOOP;
END;
$$;

-- Name every role: REVOKE FROM PUBLIC alone does not strip anon/authenticated
-- on hosted Supabase (default privileges grant them directly).
REVOKE ALL ON FUNCTION public.save_ig_caption(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ig_caption(bigint, text, jsonb) TO authenticated, service_role;
