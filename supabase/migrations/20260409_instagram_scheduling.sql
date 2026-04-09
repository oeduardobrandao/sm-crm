-- ============================================================
-- Instagram Scheduling: new columns + post_media table + storage
-- ============================================================

-- Add scheduling columns to workflow_posts
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS instagram_container_id text,
  ADD COLUMN IF NOT EXISTS instagram_media_id text,
  ADD COLUMN IF NOT EXISTS music_note text,
  ADD COLUMN IF NOT EXISTS cover_url text;

CREATE INDEX IF NOT EXISTS idx_workflow_posts_scheduled
  ON workflow_posts(scheduled_at)
  WHERE status = 'agendado';

-- ============================================================
-- post_media — media files for scheduling
-- ============================================================
CREATE TABLE IF NOT EXISTS post_media (
  id          bigserial PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url  text NOT NULL,
  media_type  text NOT NULL CHECK (media_type IN ('image', 'video')),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_media_post
  ON post_media(post_id);

-- RLS
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_post_media_all" ON post_media;
CREATE POLICY "workspace_post_media_all" ON post_media
  FOR ALL USING (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

DROP POLICY IF EXISTS "service_role_bypass_post_media" ON post_media;
CREATE POLICY "service_role_bypass_post_media" ON post_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Storage bucket: post-media (public)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-media', 'post-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: workspace members can manage files under their conta_id prefix
DROP POLICY IF EXISTS "post_media_upload" ON storage.objects;
CREATE POLICY "post_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media'
    AND (storage.foldername(name))[1] IN (SELECT public.get_my_conta_id()::text)
  );

DROP POLICY IF EXISTS "post_media_read" ON storage.objects;
CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-media');

DROP POLICY IF EXISTS "post_media_delete" ON storage.objects;
CREATE POLICY "post_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media'
    AND (storage.foldername(name))[1] IN (SELECT public.get_my_conta_id()::text)
  );

-- Service role bypass for storage cleanup from cron
DROP POLICY IF EXISTS "service_role_post_media_storage" ON storage.objects;
CREATE POLICY "service_role_post_media_storage" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'post-media') WITH CHECK (bucket_id = 'post-media');
