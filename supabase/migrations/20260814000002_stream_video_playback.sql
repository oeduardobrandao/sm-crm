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
-- deletes must be able to write the no-RLS queue table. Preserves hardening from
-- 20260727000004 (NULL r2_key guard + SET search_path) plus postcondition assert.
CREATE OR REPLACE FUNCTION public.file_enqueue_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No R2 object to reclaim: skip the queue rather than violating its NOT NULL.
  IF OLD.r2_key IS NULL THEN
    RETURN OLD;
  END IF;

  INSERT INTO file_deletions (r2_key, thumbnail_r2_key, stream_uid)
  VALUES (OLD.r2_key, OLD.thumbnail_r2_key, OLD.stream_uid);
  RETURN OLD;
END;
$$;

-- Post-condition: the guard is present, stream_uid is copied, and security
-- properties are preserved.
DO $$
DECLARE
  src text;
  sec boolean;
BEGIN
  SELECT p.prosrc, p.prosecdef INTO src, sec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'file_enqueue_delete';

  IF src IS NULL THEN
    RAISE EXCEPTION 'file_enqueue_delete() is missing';
  END IF;
  IF src NOT LIKE '%OLD.r2_key IS NULL%' THEN
    RAISE EXCEPTION 'file_enqueue_delete() is missing the NULL r2_key guard';
  END IF;
  IF src NOT LIKE '%stream_uid%' THEN
    RAISE EXCEPTION 'file_enqueue_delete() is missing stream_uid copy';
  END IF;
  IF NOT sec THEN
    RAISE EXCEPTION 'file_enqueue_delete() lost SECURITY DEFINER';
  END IF;
END $$;
