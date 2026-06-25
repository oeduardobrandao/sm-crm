-- ============================================================
-- Instagram Stories 2b: per-segment publish state
-- ============================================================

-- 1. Per-segment state column (null for non-stories)
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS story_segments jsonb;

-- 2. Backfill already-scheduled / failed stories with null-id segments. Stage 2a is
--    not deployed, so there are no in-flight single-media stories whose existing
--    instagram_container_id needs preserving; any rare such row simply re-creates its
--    container on the next container phase (the orphan container expires in 24h).
UPDATE workflow_posts wp
SET story_segments = (
  SELECT jsonb_agg(
           jsonb_build_object('file_id', pfl.file_id, 'container_id', NULL, 'media_id', NULL)
           ORDER BY pfl.sort_order)
  FROM post_file_links pfl
  WHERE pfl.post_id = wp.id
)
WHERE wp.tipo = 'stories'
  AND wp.status IN ('agendado', 'falha_publicacao')
  AND wp.story_segments IS NULL;

-- 3. Targeted single-field segment update (avoids whole-array rewrites).
--    p_value NULL clears the field (used to reset a failed container).
CREATE OR REPLACE FUNCTION set_story_segment_field(
  p_post_id bigint,
  p_index int,
  p_field text,
  p_value text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE workflow_posts
  SET story_segments = jsonb_set(
    COALESCE(story_segments, '[]'::jsonb),
    ARRAY[p_index::text, p_field],
    CASE WHEN p_value IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_value) END,
    true
  )
  WHERE id = p_post_id;
$$;

REVOKE ALL ON FUNCTION set_story_segment_field(bigint, int, text, text) FROM public;
GRANT EXECUTE ON FUNCTION set_story_segment_field(bigint, int, text, text) TO service_role;

-- 4. Story-aware claim. Non-story predicates unchanged; stories keyed off segments.
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  ig_caption text,
  scheduled_at timestamptz,
  instagram_container_id text,
  instagram_media_id text,
  publish_retry_count smallint,
  tipo text,
  story_segments jsonb,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NULL)
            OR (wp.tipo = 'stories' AND (
              wp.story_segments IS NULL
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
            ))
          )
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NOT NULL)
            OR (wp.tipo = 'stories'
              AND wp.story_segments IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'media_id' IS NULL
              )
            )
          )
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.ig_caption,
    u.scheduled_at,
    u.instagram_container_id,
    u.instagram_media_id,
    u.publish_retry_count,
    u.tipo,
    u.story_segments,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    c.id AS client_id
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
