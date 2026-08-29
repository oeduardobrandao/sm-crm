-- =====================================================================
-- 20260828000010_ig_trial_reels.sql
-- Reel de teste (Instagram Trial Reels).
-- 1) Coluna workflow_posts.ig_trial_strategy (NULL = post normal).
-- 2) Trigger que limpa a flag quando o post deixa de ser reels ou deixa
--    de mirar o Instagram (invariante autoritativa; o self-heal da UI é
--    só cortesia).
-- 3) claim_posts_for_publishing: shape muda (nova coluna no RETURNS
--    TABLE), então DROP + CREATE. Corpo copiado de 20260807000002 com
--    DUAS edições no corpo (ig_trial_strategy no SELECT final e
--    'TRIAL_INELIGIBLE' no NOT IN do retry). Este arquivo passa a ser a
--    definição canônica.
-- =====================================================================

ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS ig_trial_strategy text
  CHECK (ig_trial_strategy IN ('manual', 'auto'));

COMMENT ON COLUMN workflow_posts.ig_trial_strategy IS
  'Reel de teste (Instagram trial reel). NULL = post normal; manual = graduação manual no app do Instagram; auto = SS_PERFORMANCE (Instagram compartilha com todos se performar bem).';

CREATE OR REPLACE FUNCTION workflow_posts_clear_ig_trial()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ig_trial_strategy IS NOT NULL
     AND (NEW.tipo <> 'reels'
          OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram', 'both')) THEN
    NEW.ig_trial_strategy := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_posts_z5_clear_ig_trial ON workflow_posts;
CREATE TRIGGER workflow_posts_z5_clear_ig_trial
  BEFORE INSERT OR UPDATE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION workflow_posts_clear_ig_trial();

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
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED','TRIAL_INELIGIBLE'))
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
    c.id AS client_id,
    u.ig_trial_strategy
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
-- REVOKE FROM PUBLIC also strips service_role; the explicit re-grant is load-bearing.
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;
