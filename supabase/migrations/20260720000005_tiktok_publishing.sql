-- =====================================================================
-- 20260719000001_tiktok_publishing.sql
-- TikTok publishing backbone (spec: docs/superpowers/specs/2026-07-17-tiktok-integration-design.md)
--
-- Adds `workflow_posts` platform/publish-state columns for TikTok, the TikTok
-- claim RPC (mirrors claim_posts_for_publishing's shape, single init phase —
-- no container phase since TikTok publishing is a single POST /publish/video/init
-- call, not container-then-publish like Instagram), and mark_platform_published
-- (the aggregate completion RPC both the Instagram and TikTok publish crons call
-- once their side is done; a `both`-platform post only flips to 'postado' once
-- BOTH sides report done).
--
-- Also guards the existing claim_posts_for_publishing (Instagram claim) against
-- double-publishing: a `both`-platform post that already has an
-- instagram_media_id (IG side already published) must never be re-claimed by
-- the 'container'/'publish'/'retry' phases, even if its status is still
-- 'agendado' (TikTok side pending) or was reset to 'agendado'/'falha_publicacao'
-- by a retry. Without this guard, retrying the TikTok side of a `both` post
-- whose Instagram side already posted would cause instagram-publish-cron to
-- re-publish to Instagram.
-- =====================================================================

-- 1. Platform + TikTok publish-state columns on workflow_posts.
ALTER TABLE workflow_posts
  ADD COLUMN platform text NOT NULL DEFAULT 'instagram'
    CHECK (platform IN ('instagram','tiktok','both')),
  ADD COLUMN tiktok_publish_id text,
  ADD COLUMN tiktok_post_id text,
  ADD COLUMN tiktok_post_url text,
  ADD COLUMN tiktok_publish_status text
    CHECK (tiktok_publish_status IN ('initiated','processing','published','failed')),
  ADD COLUMN tiktok_publish_error text,
  ADD COLUMN tiktok_publish_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN tiktok_publish_processing_at timestamptz,
  ADD COLUMN tiktok_caption text,
  ADD COLUMN tiktok_title text,
  ADD COLUMN tiktok_settings jsonb;

-- ── TikTok claim (mirror of claim_posts_for_publishing, single init step: no container phase)
CREATE OR REPLACE FUNCTION claim_posts_for_tiktok_publishing(
  p_phase text,          -- 'init' | 'status' | 'retry'
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  tipo text,
  scheduled_at timestamptz,
  caption text,                 -- tiktok_caption fallback ig_caption resolved here
  tiktok_title text,
  tiktok_settings jsonb,
  tiktok_publish_id text,
  tiktok_publish_retry_count smallint,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  tiktok_account_id uuid,
  tiktok_open_id text,
  tiktok_username text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE wp.platform IN ('tiktok','both')
      AND CASE p_phase
        WHEN 'init' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND wp.tiktok_publish_status IS NULL
        WHEN 'status' THEN
          wp.status = 'agendado'
          AND wp.tiktok_publish_status IN ('initiated','processing')
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.tiktok_publish_status = 'failed'
          AND wp.tiktok_publish_retry_count < 3
      END
      AND (wp.tiktok_publish_processing_at IS NULL
           OR wp.tiktok_publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET tiktok_publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.tipo,
    u.scheduled_at,
    COALESCE(u.tiktok_caption, u.ig_caption, '') AS caption,
    u.tiktok_title,
    u.tiktok_settings,
    u.tiktok_publish_id,
    u.tiktok_publish_retry_count,
    ta.encrypted_access_token,
    ta.encrypted_refresh_token,
    ta.access_token_expires_at,
    ta.id AS tiktok_account_id,
    ta.tiktok_open_id,
    ta.username AS tiktok_username,
    c.id AS client_id
  FROM updated u
  JOIN workflows w  ON w.id = u.workflow_id
  JOIN clientes c   ON c.id = w.cliente_id
  JOIN tiktok_accounts ta ON ta.client_id = c.id AND ta.authorization_status = 'active';
$$;
REVOKE ALL ON FUNCTION claim_posts_for_tiktok_publishing(text, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_posts_for_tiktok_publishing(text, int) TO service_role;

-- ── Aggregate completion (the ONE Instagram-code change; see spec "mark_platform_published")
CREATE OR REPLACE FUNCTION mark_platform_published(
  p_post_id  bigint,
  p_platform text,               -- 'instagram' | 'tiktok'
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL,
  p_fields   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platform text;
  v_ig_media text;
  v_tt_status text;
  ig_done boolean;
  tt_done boolean;
BEGIN
  IF p_platform NOT IN ('instagram','tiktok') THEN
    RAISE EXCEPTION 'mark_platform_published: invalid platform %', p_platform;
  END IF;

  -- serialize concurrent IG/TikTok completions on the same card
  SELECT platform, instagram_media_id, tiktok_publish_status
    INTO v_platform, v_ig_media, v_tt_status
  FROM workflow_posts WHERE id = p_post_id FOR UPDATE;

  IF p_platform = 'instagram' THEN
    UPDATE workflow_posts SET
      instagram_media_id    = COALESCE(p_fields->>'instagram_media_id', instagram_media_id),
      instagram_permalink   = COALESCE(p_fields->>'instagram_permalink', instagram_permalink),
      published_at          = COALESCE((p_fields->>'published_at')::timestamptz, published_at),
      publish_processing_at = NULL,
      publish_error         = NULL,
      publish_retry_count   = 0
    WHERE id = p_post_id;
    v_ig_media := COALESCE(p_fields->>'instagram_media_id', v_ig_media);
  ELSE
    UPDATE workflow_posts SET
      tiktok_publish_status = 'published',
      tiktok_post_id        = COALESCE(p_fields->>'tiktok_post_id', tiktok_post_id),
      tiktok_post_url       = COALESCE(p_fields->>'tiktok_post_url', tiktok_post_url),
      published_at          = COALESCE(published_at, (p_fields->>'published_at')::timestamptz),
      tiktok_publish_processing_at = NULL,
      tiktok_publish_error  = NULL
    WHERE id = p_post_id;
    v_tt_status := 'published';
  END IF;

  ig_done := (v_platform = 'tiktok')    OR v_ig_media IS NOT NULL;
  tt_done := (v_platform = 'instagram') OR v_tt_status = 'published';

  IF ig_done AND tt_done THEN
    PERFORM record_post_status_change(p_post_id, 'postado', p_source, p_actor, NULL, '{}'::jsonb);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;

-- ── Guard the IG claim against double-publish on `both` retries.
-- Re-created (full body copied) from supabase/migrations/20260625000001_instagram_story_segments.sql
-- with exactly THREE edits vs that text:
--   1. top-level WHERE gains: AND wp.platform IN ('instagram','both')
--   2. 'container' and 'publish' phases each gain: AND wp.instagram_media_id IS NULL
--   3. 'retry' phase gains: AND wp.instagram_media_id IS NULL
-- DROP first: mirrors the DROP-then-CREATE pattern 20260625000001 established for
-- this function (there, changing the RETURNS TABLE shape required it; here the
-- shape is unchanged, but we keep the same DROP+CREATE form for consistency with
-- that migration's text, which is what we are copying almost verbatim). Safe —
-- only the cron calls this via RPC; no view/trigger depends on it.
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
