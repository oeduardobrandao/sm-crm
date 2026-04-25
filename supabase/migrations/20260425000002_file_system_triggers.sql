-- supabase/migrations/20260425000002_file_system_triggers.sql

-- ============================================================
-- AUTO-FOLDER SYNC: CLIENTES
-- ============================================================
CREATE OR REPLACE FUNCTION folder_sync_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO folders (conta_id, name, source, source_type, source_id)
    VALUES (NEW.conta_id, NEW.nome, 'system', 'client', NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.nome IS DISTINCT FROM OLD.nome THEN
      UPDATE folders SET name = NEW.nome, updated_at = now()
      WHERE source_type = 'client' AND source_id = NEW.id
        AND conta_id = NEW.conta_id AND name_overridden = false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM folders
    WHERE source_type = 'client' AND source_id = OLD.id AND conta_id = OLD.conta_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_folder_sync_cliente
  AFTER INSERT OR UPDATE OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION folder_sync_cliente();

-- ============================================================
-- AUTO-FOLDER SYNC: WORKFLOWS
-- ============================================================
CREATE OR REPLACE FUNCTION folder_sync_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id bigint;
  v_new_parent_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_parent_id FROM folders
    WHERE source_type = 'client' AND source_id = NEW.cliente_id AND conta_id = NEW.conta_id;

    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (NEW.conta_id, v_parent_id, NEW.titulo, 'system', 'workflow', NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN
      UPDATE folders SET name = NEW.titulo, updated_at = now()
      WHERE source_type = 'workflow' AND source_id = NEW.id
        AND conta_id = NEW.conta_id AND name_overridden = false;
    END IF;

    IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
      SELECT id INTO v_new_parent_id FROM folders
      WHERE source_type = 'client' AND source_id = NEW.cliente_id AND conta_id = NEW.conta_id;

      UPDATE folders SET parent_id = v_new_parent_id, updated_at = now()
      WHERE source_type = 'workflow' AND source_id = NEW.id AND conta_id = NEW.conta_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM folders
    WHERE source_type = 'workflow' AND source_id = OLD.id AND conta_id = OLD.conta_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_folder_sync_workflow
  AFTER INSERT OR UPDATE OR DELETE ON workflows
  FOR EACH ROW EXECUTE FUNCTION folder_sync_workflow();

-- ============================================================
-- AUTO-FOLDER SYNC: WORKFLOW_POSTS
-- ============================================================
CREATE OR REPLACE FUNCTION folder_sync_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_parent_id FROM folders
    WHERE source_type = 'workflow' AND source_id = NEW.workflow_id AND conta_id = NEW.conta_id;

    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (NEW.conta_id, v_parent_id, NEW.titulo, 'system', 'post', NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN
      UPDATE folders SET name = NEW.titulo, updated_at = now()
      WHERE source_type = 'post' AND source_id = NEW.id
        AND conta_id = NEW.conta_id AND name_overridden = false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM folders
    WHERE source_type = 'post' AND source_id = OLD.id AND conta_id = OLD.conta_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_folder_sync_post
  AFTER INSERT OR UPDATE OR DELETE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION folder_sync_post();

-- ============================================================
-- REFERENCE COUNT ON FILES
-- ============================================================
CREATE OR REPLACE FUNCTION file_update_reference_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE files SET reference_count = reference_count + 1
    WHERE id = NEW.file_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE files SET reference_count = GREATEST(0, reference_count - 1)
    WHERE id = OLD.file_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_file_ref_count_ins
  AFTER INSERT ON post_file_links
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

CREATE TRIGGER trg_file_ref_count_del
  AFTER DELETE ON post_file_links
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- ============================================================
-- COVER BEHAVIOR ON POST_FILE_LINKS
-- ============================================================
CREATE OR REPLACE FUNCTION post_file_link_auto_cover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM post_file_links WHERE post_id = NEW.post_id AND is_cover = true
  ) THEN
    NEW.is_cover := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_file_link_auto_cover
  BEFORE INSERT ON post_file_links
  FOR EACH ROW EXECUTE FUNCTION post_file_link_auto_cover();

CREATE OR REPLACE FUNCTION post_file_link_reassign_cover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next_id bigint;
BEGIN
  IF OLD.is_cover = false THEN
    RETURN OLD;
  END IF;

  SELECT id INTO v_next_id FROM post_file_links
  WHERE post_id = OLD.post_id AND id != OLD.id
  ORDER BY sort_order ASC, id ASC
  LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE post_file_links SET is_cover = true WHERE id = v_next_id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_post_file_link_reassign_cover
  AFTER DELETE ON post_file_links
  FOR EACH ROW EXECUTE FUNCTION post_file_link_reassign_cover();

-- ============================================================
-- FILE DELETION QUEUE
-- ============================================================
CREATE OR REPLACE FUNCTION file_enqueue_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO file_deletions (r2_key, thumbnail_r2_key)
  VALUES (OLD.r2_key, OLD.thumbnail_r2_key);
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_file_enqueue_delete
  AFTER DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION file_enqueue_delete();

-- ============================================================
-- QUOTA ENFORCEMENT
-- ============================================================
CREATE OR REPLACE FUNCTION file_insert_with_quota(p jsonb) RETURNS files
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota  bigint;
  v_used   bigint;
  v_row    files;
BEGIN
  SELECT storage_quota_bytes, storage_used_bytes
    INTO v_quota, v_used
    FROM workspaces
   WHERE id = (p->>'conta_id')::uuid
     FOR UPDATE;

  IF v_quota IS NOT NULL AND v_used + (p->>'size_bytes')::bigint > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded';
  END IF;

  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, uploaded_by
  ) VALUES (
    (p->>'conta_id')::uuid,
    NULLIF(p->>'folder_id', '')::bigint,
    p->>'r2_key',
    NULLIF(p->>'thumbnail_r2_key', ''),
    p->>'name',
    p->>'kind',
    p->>'mime_type',
    (p->>'size_bytes')::bigint,
    NULLIF(p->>'width', '')::int,
    NULLIF(p->>'height', '')::int,
    NULLIF(p->>'duration_seconds', '')::int,
    NULLIF(p->>'uploaded_by', '')::uuid
  ) RETURNING * INTO v_row;

  UPDATE workspaces
     SET storage_used_bytes = storage_used_bytes + v_row.size_bytes
   WHERE id = v_row.conta_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION file_update_used_bytes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE workspaces
       SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.size_bytes)
     WHERE id = OLD.conta_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_file_used_bytes_del
  AFTER DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION file_update_used_bytes();

-- Cover swap RPC (mirrors post_media_set_cover pattern).
-- A single UPDATE flips both rows atomically. Postgres checks the partial
-- unique index at statement end, so the intermediate state is fine.
CREATE OR REPLACE FUNCTION post_file_link_set_cover(p_link_id bigint) RETURNS post_file_links
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_post_id bigint;
  v_row     post_file_links;
BEGIN
  SELECT post_id INTO v_post_id FROM post_file_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'link not found'; END IF;

  UPDATE post_file_links
     SET is_cover = (id = p_link_id)
   WHERE post_id = v_post_id AND is_cover != (id = p_link_id);

  SELECT * INTO v_row FROM post_file_links WHERE id = p_link_id;
  RETURN v_row;
END;
$$;
