-- supabase/migrations/20260425000001_file_system_tables.sql

-- ============================================================
-- FOLDERS
-- ============================================================
CREATE TABLE folders (
  id              bigserial PRIMARY KEY,
  conta_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id       bigint REFERENCES folders(id) ON DELETE CASCADE,
  name            text NOT NULL,
  source          text NOT NULL DEFAULT 'user' CHECK (source IN ('system', 'user')),
  source_type     text CHECK (source_type IN ('client', 'workflow', 'post')),
  source_id       bigint,
  name_overridden boolean NOT NULL DEFAULT false,
  position        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX folders_source_unique
  ON folders (conta_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX folders_parent_idx ON folders (conta_id, parent_id);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY folders_tenant_all ON folders
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY folders_service_role_bypass ON folders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- FILES
-- ============================================================
CREATE TABLE files (
  id                bigserial PRIMARY KEY,
  conta_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id         bigint REFERENCES folders(id) ON DELETE SET NULL,
  r2_key            text NOT NULL,
  thumbnail_r2_key  text,
  name              text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('image', 'video', 'document')),
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes > 0),
  width             int,
  height            int,
  duration_seconds  int,
  blur_data_url     text,
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reference_count   int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_video_requires_thumbnail
    CHECK (kind != 'video' OR thumbnail_r2_key IS NOT NULL)
);

CREATE INDEX files_folder_idx ON files (conta_id, folder_id);
CREATE INDEX files_r2_key_idx ON files (r2_key);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY files_tenant_all ON files
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY files_service_role_bypass ON files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- POST_FILE_LINKS
-- ============================================================
CREATE TABLE post_file_links (
  id          bigserial PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  file_id     bigint NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  conta_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  is_cover    boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX post_file_links_unique ON post_file_links (post_id, file_id);
CREATE UNIQUE INDEX post_file_links_one_cover
  ON post_file_links (post_id) WHERE is_cover = true;

ALTER TABLE post_file_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_file_links_tenant_all ON post_file_links
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY post_file_links_service_role_bypass ON post_file_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- FILE_DELETIONS
-- ============================================================
CREATE TABLE file_deletions (
  id                bigserial PRIMARY KEY,
  r2_key            text NOT NULL,
  thumbnail_r2_key  text,
  queued_at         timestamptz NOT NULL DEFAULT now(),
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  next_retry_at     timestamptz NOT NULL DEFAULT now()
);

-- No RLS — written by SECURITY DEFINER triggers, read by service-role cron only.
