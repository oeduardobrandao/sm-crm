-- Atomic quota enforcement for post_media uploads.
-- The previous check summed size_bytes at upload-url time, which is advisory only:
-- concurrent finalizes all see the same "used" total and can collectively exceed quota.
-- This migration adds a maintained counter on workspaces and an atomic RPC that
-- finalize uses to reserve bytes in a single transactional UPDATE.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_used_bytes bigint NOT NULL DEFAULT 0;

-- Backfill from any existing post_media rows.
UPDATE workspaces w
  SET storage_used_bytes = COALESCE(sub.total, 0)
  FROM (
    SELECT conta_id, SUM(size_bytes) AS total
    FROM post_media
    GROUP BY conta_id
  ) sub
  WHERE sub.conta_id = w.id;

-- Keep storage_used_bytes in sync with post_media inserts/deletes.
CREATE OR REPLACE FUNCTION post_media_update_used_bytes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE workspaces
      SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
      WHERE id = NEW.conta_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE workspaces
      SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes)
      WHERE id = OLD.conta_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS post_media_used_bytes_ins ON post_media;
CREATE TRIGGER post_media_used_bytes_ins
  AFTER INSERT ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_update_used_bytes();

DROP TRIGGER IF EXISTS post_media_used_bytes_del ON post_media;
CREATE TRIGGER post_media_used_bytes_del
  AFTER DELETE ON post_media
  FOR EACH ROW EXECUTE FUNCTION post_media_update_used_bytes();

-- Atomic insert-with-quota helper. Locks the workspace row, re-checks quota against
-- the live counter, and inserts the post_media row in a single transaction. Concurrent
-- finalizes serialize on workspaces FOR UPDATE, so no finalize can slip through after
-- another has already pushed the tenant over quota.
--
-- Returns the inserted post_media row (as jsonb) on success, raises 'quota_exceeded'
-- on failure.
CREATE OR REPLACE FUNCTION post_media_insert_with_quota(p jsonb)
RETURNS post_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id uuid := (p->>'conta_id')::uuid;
  v_needed   bigint := (p->>'size_bytes')::bigint;
  v_quota    bigint;
  v_used     bigint;
  v_row      post_media;
BEGIN
  SELECT storage_quota_bytes, storage_used_bytes
    INTO v_quota, v_used
    FROM workspaces
    WHERE id = v_conta_id
    FOR UPDATE;

  IF v_quota IS NOT NULL AND (v_used + v_needed) > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO post_media (
    post_id, conta_id, r2_key, thumbnail_r2_key, kind, mime_type, size_bytes,
    original_filename, width, height, duration_seconds, is_cover, uploaded_by
  ) VALUES (
    (p->>'post_id')::bigint,
    v_conta_id,
    p->>'r2_key',
    NULLIF(p->>'thumbnail_r2_key', ''),
    p->>'kind',
    p->>'mime_type',
    v_needed,
    p->>'original_filename',
    NULLIF(p->>'width','')::int,
    NULLIF(p->>'height','')::int,
    NULLIF(p->>'duration_seconds','')::int,
    (p->>'is_cover')::boolean,
    (p->>'uploaded_by')::uuid
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Atomic cover swap: sets is_cover=true on the target row and false on all siblings
-- in a single statement. PostgreSQL defers unique-constraint checks to statement end,
-- so this does not violate the partial unique index on (post_id) WHERE is_cover=true.
CREATE OR REPLACE FUNCTION post_media_set_cover(p_media_id bigint)
RETURNS post_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id bigint;
  v_row     post_media;
BEGIN
  SELECT post_id INTO v_post_id FROM post_media WHERE id = p_media_id;
  IF v_post_id IS NULL THEN
    RAISE EXCEPTION 'media not found';
  END IF;
  UPDATE post_media SET is_cover = (id = p_media_id) WHERE post_id = v_post_id;
  SELECT * INTO v_row FROM post_media WHERE id = p_media_id;
  RETURN v_row;
END;
$$;
