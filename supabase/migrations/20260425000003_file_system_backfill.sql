-- supabase/migrations/20260425000003_file_system_backfill.sql
-- Backfills folders from existing clients, workflows, and posts,
-- then migrates post_media rows into the files + post_file_links tables.
-- No R2 re-upload needed — r2_keys are preserved as-is.

-- Disable auto-folder triggers during backfill to avoid duplicates.
ALTER TABLE clientes DISABLE TRIGGER trg_folder_sync_cliente;
ALTER TABLE workflows DISABLE TRIGGER trg_folder_sync_workflow;
ALTER TABLE workflow_posts DISABLE TRIGGER trg_folder_sync_post;

-- Also disable reference count and cover triggers during bulk insert.
ALTER TABLE post_file_links DISABLE TRIGGER trg_file_ref_count_ins;
ALTER TABLE post_file_links DISABLE TRIGGER trg_post_file_link_auto_cover;

-- Step 1: Backfill client folders
INSERT INTO folders (conta_id, name, source, source_type, source_id)
SELECT conta_id, nome, 'system', 'client', id
FROM clientes
WHERE conta_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 2: Backfill workflow folders
INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
SELECT w.conta_id, cf.id, w.titulo, 'system', 'workflow', w.id
FROM workflows w
JOIN folders cf ON cf.source_type = 'client' AND cf.source_id = w.cliente_id AND cf.conta_id = w.conta_id
ON CONFLICT DO NOTHING;

-- Step 3: Backfill post folders
INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
SELECT wp.conta_id, wf.id, wp.titulo, 'system', 'post', wp.id
FROM workflow_posts wp
JOIN folders wf ON wf.source_type = 'workflow' AND wf.source_id = wp.workflow_id AND wf.conta_id = wp.conta_id
ON CONFLICT DO NOTHING;

-- Step 4: Migrate post_media → files
INSERT INTO files (
  conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
  size_bytes, width, height, duration_seconds, blur_data_url,
  uploaded_by, reference_count, created_at
)
SELECT
  pm.conta_id,
  pf.id AS folder_id,
  pm.r2_key,
  NULLIF(pm.thumbnail_r2_key, ''),
  pm.original_filename,
  pm.kind,
  pm.mime_type,
  pm.size_bytes,
  pm.width,
  pm.height,
  pm.duration_seconds,
  pm.blur_data_url,
  pm.uploaded_by,
  1,  -- each migrated file has exactly one link
  pm.created_at
FROM post_media pm
JOIN workflow_posts wp ON wp.id = pm.post_id
JOIN folders pf ON pf.source_type = 'post' AND pf.source_id = pm.post_id AND pf.conta_id = pm.conta_id;

-- Step 5: Create post_file_links
INSERT INTO post_file_links (post_id, file_id, conta_id, is_cover, sort_order, created_at)
SELECT
  pm.post_id,
  f.id,
  pm.conta_id,
  pm.is_cover,
  pm.sort_order,
  pm.created_at
FROM post_media pm
JOIN files f ON f.r2_key = pm.r2_key AND f.conta_id = pm.conta_id;

-- Re-enable triggers
ALTER TABLE clientes ENABLE TRIGGER trg_folder_sync_cliente;
ALTER TABLE workflows ENABLE TRIGGER trg_folder_sync_workflow;
ALTER TABLE workflow_posts ENABLE TRIGGER trg_folder_sync_post;
ALTER TABLE post_file_links ENABLE TRIGGER trg_file_ref_count_ins;
ALTER TABLE post_file_links ENABLE TRIGGER trg_post_file_link_auto_cover;
