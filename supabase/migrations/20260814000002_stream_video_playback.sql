-- Cloudflare Stream playback (spec 2026-08-13). stream_uid/stream_status live
-- only on files: post_media holds zero videos (all post video is files +
-- post_file_links).
ALTER TABLE files
  ADD COLUMN stream_uid text,
  ADD COLUMN stream_status text CHECK (stream_status IN ('pending', 'ready', 'error'));

CREATE INDEX files_stream_uid_idx ON files (stream_uid) WHERE stream_uid IS NOT NULL;
-- Ingest catch-up sweep scans "video rows not yet in Stream" by age.
CREATE INDEX files_stream_ingest_idx ON files (created_at)
  WHERE kind = 'video' AND stream_uid IS NULL;

ALTER TABLE file_deletions ADD COLUMN stream_uid text;

-- Same function, one more copied column. Stays SECURITY DEFINER: tenant-RLS'd
-- deletes must be able to write the no-RLS queue table.
CREATE OR REPLACE FUNCTION file_enqueue_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO file_deletions (r2_key, thumbnail_r2_key, stream_uid)
  VALUES (OLD.r2_key, OLD.thumbnail_r2_key, OLD.stream_uid);
  RETURN OLD;
END;
$$;
