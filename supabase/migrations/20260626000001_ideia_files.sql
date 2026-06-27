-- supabase/migrations/20260626000001_ideia_files.sql
-- Image attachments for ideas. Images are OWNED by the idea (not shared
-- file-manager assets), reusing the files infra for quota/thumbnails/cleanup.

-- Prerequisite UNIQUE constraints so the composite FKs can reference them.
-- (Postgres FKs require a UNIQUE/PK constraint, not merely a unique index.)
ALTER TABLE ideias ADD CONSTRAINT ideias_id_workspace_uq UNIQUE (id, workspace_id);
ALTER TABLE files  ADD CONSTRAINT files_id_conta_uq       UNIQUE (id, conta_id);

CREATE TABLE ideia_files (
  id          bigserial PRIMARY KEY,
  ideia_id    uuid   NOT NULL,
  file_id     bigint NOT NULL,
  conta_id    uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sort_order  int    NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Composite FKs pin the idea AND the file to the link's own workspace,
  -- making cross-tenant links structurally impossible (defense-in-depth).
  CONSTRAINT ideia_files_ideia_fk
    FOREIGN KEY (ideia_id, conta_id) REFERENCES ideias(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT ideia_files_file_fk
    FOREIGN KEY (file_id, conta_id)  REFERENCES files(id, conta_id)      ON DELETE CASCADE
);

CREATE UNIQUE INDEX ideia_files_unique ON ideia_files (ideia_id, file_id);
CREATE INDEX ideia_files_ideia_idx ON ideia_files (ideia_id);

ALTER TABLE ideia_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY ideia_files_tenant_all ON ideia_files
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY ideia_files_service_role_bypass ON ideia_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Keep files.reference_count accurate (reuse the existing trigger function).
CREATE TRIGGER trg_ideia_file_ref_count_ins
  AFTER INSERT ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();
CREATE TRIGGER trg_ideia_file_ref_count_del
  AFTER DELETE ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION file_update_reference_count();

-- When the last reference to a file disappears, delete the file row. That
-- cascade fires the existing file_enqueue_delete (R2 cleanup) and
-- file_update_used_bytes (frees quota). Checks references directly so it is
-- independent of trigger firing order.
CREATE OR REPLACE FUNCTION ideia_file_cleanup_orphan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ideia_files     WHERE file_id = OLD.file_id)
     AND NOT EXISTS (SELECT 1 FROM post_file_links WHERE file_id = OLD.file_id) THEN
    DELETE FROM files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_ideia_file_cleanup_orphan
  AFTER DELETE ON ideia_files
  FOR EACH ROW EXECUTE FUNCTION ideia_file_cleanup_orphan();

-- Atomic finalize: ownership lock + cap + quota + file insert + link insert.
-- Returns the inserted files row.
CREATE OR REPLACE FUNCTION ideia_file_insert_with_quota(p jsonb) RETURNS files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta_id    uuid   := (p->>'conta_id')::uuid;
  v_cliente_id  int    := NULLIF(p->>'cliente_id', '')::int;
  v_ideia_id    uuid   := (p->>'ideia_id')::uuid;
  v_size        bigint := (p->>'size_bytes')::bigint;
  v_idea_owner  int;
  v_count       int;
  v_quota       bigint;
  v_used        bigint;
  v_row         files;
BEGIN
  -- 1. Lock the idea row: verifies workspace ownership AND serializes
  --    concurrent finalizes for the same idea (race-safe cap).
  SELECT cliente_id INTO v_idea_owner
    FROM ideias
   WHERE id = v_ideia_id AND workspace_id = v_conta_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ideia_not_found' USING errcode = 'P0001'; END IF;
  IF v_cliente_id IS NOT NULL AND v_idea_owner <> v_cliente_id THEN
    RAISE EXCEPTION 'ideia_not_found' USING errcode = 'P0001';
  END IF;

  -- 2. Cap (now serialized by the lock above).
  SELECT count(*) INTO v_count FROM ideia_files WHERE ideia_id = v_ideia_id;
  IF v_count >= 10 THEN RAISE EXCEPTION 'image_limit' USING errcode = 'P0001'; END IF;

  -- 3. Quota. Charges size_bytes only, symmetric with the size-only refund in
  --    file_update_used_bytes (thumbnails uncounted, like the post path) to avoid
  --    drift. Plan-driven via effective_plan_limit (NULL = unlimited), matching
  --    file_insert_with_quota. Lock the workspace row for the used-bytes read.
  SELECT storage_used_bytes INTO v_used FROM workspaces WHERE id = v_conta_id FOR UPDATE;
  v_quota := effective_plan_limit(v_conta_id, 'storage_quota_bytes');
  IF v_quota IS NOT NULL AND COALESCE(v_used, 0) + v_size > v_quota THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = 'P0001';
  END IF;

  -- 4. Insert the file (folder_id NULL: idea images are not file-manager assets).
  INSERT INTO files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, blur_data_url, uploaded_by
  ) VALUES (
    v_conta_id, NULL, p->>'r2_key', NULLIF(p->>'thumbnail_r2_key',''),
    p->>'name', 'image', p->>'mime_type', v_size,
    NULLIF(p->>'width','')::int, NULLIF(p->>'height','')::int,
    NULLIF(p->>'blur_data_url',''), NULLIF(p->>'uploaded_by','')::uuid
  ) RETURNING * INTO v_row;

  -- 5. Link it (fires reference_count trigger).
  INSERT INTO ideia_files (ideia_id, file_id, conta_id, sort_order)
  VALUES (v_ideia_id, v_row.id, v_conta_id,
          COALESCE(NULLIF(p->>'sort_order','')::int, 0));

  -- 6. Charge quota (file only; symmetric with the size-only refund).
  UPDATE workspaces SET storage_used_bytes = storage_used_bytes + v_size
   WHERE id = v_conta_id;

  RETURN v_row;
END;
$$;
