-- =====================================================================
-- 20260807000002_claim_skip_nonretryable.sql
-- Fase 'retry' do claim IG passa a pular códigos não-retryable: um token
-- expirado ou mídia inválida nunca se resolve sozinho, e as 3 tentativas
-- idênticas só queimavam chamadas ao Graph.
-- Corpo copiado de 20260720000005_tiktok_publishing.sql com UMA edição
-- (WHEN 'retry'). Este arquivo passa a ser a definição canônica.
-- =====================================================================

-- DROP first: the shape is unchanged, but this mirrors the DROP-then-CREATE form
-- the function already used in 20260720000005. Safe — only the cron calls this
-- via RPC; no view/trigger depends on it.
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
  client_id bigint
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
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED'))
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
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;
