-- Post media (photos/videos) attached to workflow_posts, stored in Cloudflare R2.

-- 1. Quota column on workspaces (null = unlimited)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint NULL;

-- 2. Main table
CREATE TABLE IF NOT EXISTS post_media (
  id                  bigserial PRIMARY KEY,
  post_id             bigint   NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id            uuid     NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  r2_key              text     NOT NULL,
  thumbnail_r2_key    text     NULL,
  kind                text     NOT NULL CHECK (kind IN ('image', 'video')),
  mime_type           text     NOT NULL,
  size_bytes          bigint   NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 419430400),
  original_filename   text     NOT NULL,
  width               int      NULL,
  height              int      NULL,
  duration_seconds    int      NULL,
  is_cover            boolean  NOT NULL DEFAULT false,
  sort_order          int      NOT NULL DEFAULT 0,
  uploaded_by         uuid     NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_media_video_requires_thumbnail
    CHECK (kind = 'image' OR thumbnail_r2_key IS NOT NULL)
);

CREATE INDEX post_media_post_idx   ON post_media(post_id);
CREATE INDEX post_media_conta_idx  ON post_media(conta_id);
CREATE UNIQUE INDEX post_media_one_cover_per_post
  ON post_media(post_id) WHERE is_cover = true;

-- 3. Deletion queue (populated by trigger, drained by cron)
CREATE TABLE IF NOT EXISTS post_media_deletions (
  id           bigserial PRIMARY KEY,
  r2_key       text NOT NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text NULL
);

-- 4. Trigger: on delete, enqueue both main key and thumbnail
CREATE OR REPLACE FUNCTION post_media_enqueue_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO post_media_deletions(r2_key) VALUES (OLD.r2_key);
  IF OLD.thumbnail_r2_key IS NOT NULL THEN
    INSERT INTO post_media_deletions(r2_key) VALUES (OLD.thumbnail_r2_key);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER post_media_after_delete
  AFTER DELETE ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_enqueue_delete();

-- 5. Trigger: on delete of cover, promote next item (lowest sort_order, then id)
CREATE OR REPLACE FUNCTION post_media_reassign_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_cover THEN
    UPDATE post_media
    SET is_cover = true
    WHERE id = (
      SELECT id FROM post_media
      WHERE post_id = OLD.post_id AND is_cover = false
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER post_media_after_delete_cover
  AFTER DELETE ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_reassign_cover();

-- 6. RLS
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_media_tenant_all" ON post_media
  FOR ALL
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "post_media_service_role_bypass" ON post_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE post_media_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_media_deletions_service_only" ON post_media_deletions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
