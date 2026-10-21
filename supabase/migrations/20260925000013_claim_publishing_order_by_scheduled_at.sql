-- claim_posts_for_publishing had no ORDER BY inside its SKIP LOCKED CTE: when
-- eligible rows exceed p_limit (now routine at peak scheduling minutes, e.g.
-- 13:00 UTC -- see PUBLISH_LIMIT bump in instagram-publish-cron/index.ts), which
-- posts get claimed this tick vs. deferred to the next one was whatever order
-- Postgres happened to scan them in, not oldest-scheduled-first. Adds
-- ORDER BY wp.scheduled_at, wp.id so overflow is deterministic and fair.
--
-- Full body copied verbatim from the canonical 20260921000001, only the ORDER BY
-- line is new.
DROP FUNCTION IF EXISTS claim_posts_for_publishing(text, integer);
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
  client_id bigint,
  ig_trial_strategy text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      wp.platform IN ('instagram','both')
      AND CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND wp.instagram_media_id IS NULL
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
          AND wp.instagram_media_id IS NULL
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
          AND wp.instagram_media_id IS NULL
          AND (wp.publish_error_code IS NULL
               OR wp.publish_error_code NOT IN
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED','TRIAL_INELIGIBLE','CAPTION_TOO_LONG','ACCOUNT_RESTRICTED'))
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    ORDER BY wp.scheduled_at, wp.id
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
    u.cliente_id AS client_id,
    u.ig_trial_strategy
  FROM updated u
  JOIN instagram_accounts ia ON ia.client_id = u.cliente_id;
$$;
-- service_role only; FROM public sozinho nao basta em hosted Supabase, onde os
-- default privileges concedem EXECUTE direto a anon/authenticated (mesmo
-- gotcha documentado no bloco do sweep mais abaixo, 20260806000002) -- e o
-- DROP+CREATE acima reseta a ACL desta funcao para esses defaults.
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;
