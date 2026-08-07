-- =====================================================================
-- 20260807000001_publish_error_code.sql
-- Coluna de classificação estável do erro de publicação (Instagram).
-- Sem CHECK constraint de propósito: um código novo emitido pelo
-- classificador não pode quebrar o insert do cron.
-- =====================================================================

ALTER TABLE workflow_posts ADD COLUMN IF NOT EXISTS publish_error_code text;

-- ---------- record_post_status_change: allowlist ganha publish_error_code
-- Corpo copiado da definição mais recente (20260606000001_post_status_events.sql),
-- com UMA adição: o case de publish_error_code. Este arquivo passa a ser a
-- definição canônica; a próxima migration que tocar esta função deve copiar daqui.
create or replace function record_post_status_change(
  p_post_id     bigint,
  p_new_status  text,
  p_source      text   default 'system',
  p_actor       uuid   default null,
  p_approval_id bigint default null,
  p_fields      jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source not in ('workspace_user', 'client', 'system') then
    raise exception 'record_post_status_change: invalid source %', p_source;
  end if;

  perform set_config('app.actor_id',         coalesce(p_actor::text, ''),       true);
  perform set_config('app.event_source',     coalesce(p_source, ''),            true);
  perform set_config('app.post_approval_id', coalesce(p_approval_id::text, ''), true);

  update workflow_posts set
    status = p_new_status,
    instagram_container_id = case when p_fields ? 'instagram_container_id'
      then (p_fields->>'instagram_container_id') else instagram_container_id end,
    instagram_media_id = case when p_fields ? 'instagram_media_id'
      then (p_fields->>'instagram_media_id') else instagram_media_id end,
    instagram_permalink = case when p_fields ? 'instagram_permalink'
      then (p_fields->>'instagram_permalink') else instagram_permalink end,
    published_at = case when p_fields ? 'published_at'
      then (p_fields->>'published_at')::timestamptz else published_at end,
    scheduled_at = case when p_fields ? 'scheduled_at'
      then (p_fields->>'scheduled_at')::timestamptz else scheduled_at end,
    publish_processing_at = case when p_fields ? 'publish_processing_at'
      then (p_fields->>'publish_processing_at')::timestamptz else publish_processing_at end,
    publish_error = case when p_fields ? 'publish_error'
      then (p_fields->>'publish_error') else publish_error end,
    publish_error_code = case when p_fields ? 'publish_error_code'
      then (p_fields->>'publish_error_code') else publish_error_code end,
    publish_retry_count = case when p_fields ? 'publish_retry_count'
      then (p_fields->>'publish_retry_count')::int else publish_retry_count end
  where id = p_post_id;
end;
$$;

revoke all on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) from public;
grant execute on function record_post_status_change(bigint, text, text, uuid, bigint, jsonb) to service_role;

-- ---------- mark_platform_published: sucesso do IG limpa também o código
-- Corpo copiado da definição mais recente (20260720000005_tiktok_publishing.sql),
-- com UMA adição no branch do Instagram: publish_error_code = NULL.
-- Este arquivo passa a ser a definição canônica.
CREATE OR REPLACE FUNCTION mark_platform_published(
  p_post_id  bigint,
  p_platform text,
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
      publish_error_code    = NULL,
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
