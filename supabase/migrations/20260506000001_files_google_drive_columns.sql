-- Allow files from Google Drive (no R2 storage)
ALTER TABLE files ALTER COLUMN r2_key DROP NOT NULL;

-- Google Drive metadata columns
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_file_id text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_thumbnail_url text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS google_drive_view_url text;

-- Ensure either r2_key or google_drive_file_id is set (one source required)
ALTER TABLE files ADD CONSTRAINT files_has_source
  CHECK (r2_key IS NOT NULL OR google_drive_file_id IS NOT NULL);

-- Update video thumbnail constraint: only require R2 thumbnail for R2-sourced videos
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_video_requires_thumbnail;
ALTER TABLE files ADD CONSTRAINT files_video_requires_thumbnail
  CHECK (kind != 'video' OR thumbnail_r2_key IS NOT NULL OR google_drive_file_id IS NOT NULL);
