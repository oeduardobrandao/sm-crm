# File System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a file-first media management system where all uploads create `files` records, workflow posts link to files via a junction table, and auto-generated folders mirror the client/workflow/post hierarchy.

**Architecture:** Four new Postgres tables (`folders`, `files`, `post_file_links`, `file_deletions`) with triggers for auto-folder sync, reference counting, cover management, and quota enforcement. Three new Deno edge functions handle file uploads and CRUD. Existing `post-media-manage` becomes an adapter, `hub-posts` joins through the new tables, and the cleanup cron drains the new deletion queue. A React file browser page (`/arquivos`) provides the UI, with a reusable file picker modal embedded in the entregas workflow.

**Tech Stack:** Postgres (triggers, RPC), Deno edge functions, Cloudflare R2, React 19, TanStack Query, React Router v7, Tailwind CSS, shadcn/ui, lucide-react

**Spec:** `docs/superpowers/specs/2026-04-24-file-system-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260425000001_file_system_tables.sql` | Create folders, files, post_file_links, file_deletions tables with constraints, indexes, RLS |
| `supabase/migrations/20260425000002_file_system_triggers.sql` | Auto-folder sync triggers, reference count, cover behavior, quota RPC, deletion queue |
| `supabase/migrations/20260425000003_file_system_backfill.sql` | Migrate existing data: backfill folders, move post_media → files, create links |
| `supabase/functions/file-upload-url/index.ts` | Generate presigned R2 upload URL for any file type |
| `supabase/functions/file-upload-finalize/index.ts` | Verify R2 object, atomic quota enforcement, insert files row |
| `supabase/functions/file-manage/index.ts` | CRUD for files and folders, link/unlink files to posts |
| ~~`supabase/functions/file-cleanup-cron/index.ts`~~ | *(Not created — existing cron is updated instead to drain both queues)* |
| `apps/crm/src/services/fileService.ts` | Client-side API for file/folder operations |
| `apps/crm/src/pages/arquivos/ArquivosPage.tsx` | Main file browser page component |
| `apps/crm/src/pages/arquivos/types.ts` | Shared TypeScript types for file system |
| `apps/crm/src/pages/arquivos/components/FolderTree.tsx` | Collapsible folder tree sidebar |
| `apps/crm/src/pages/arquivos/components/FileGrid.tsx` | File grid/list view with thumbnails |
| `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx` | Breadcrumb navigation |
| `apps/crm/src/pages/arquivos/components/FileUploader.tsx` | Upload with drag-and-drop and progress |
| `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx` | Reusable modal for selecting existing files |
| `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx` | Right-click context menu for file/folder actions |

### Modified files

| File | Change |
|------|--------|
| `supabase/functions/post-media-manage/index.ts` | Rewrite as adapter: queries `post_file_links` + `files`, returns legacy `PostMedia` shape |
| `supabase/functions/hub-posts/handler.ts` | Join through `post_file_links` → `files` instead of `post_media` |
| `supabase/functions/post-media-cleanup-cron/index.ts` | Also drain `file_deletions` table alongside `post_media_deletions` |
| `apps/crm/src/App.tsx` | Add `/arquivos` lazy route |
| `apps/crm/src/components/layout/Sidebar.tsx` | Add "Arquivos" nav item in Gestão group |
| `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` | Add "Escolher arquivo" button, unlink flow |
| `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` | Add "Arquivos" section |

---

## Task 1: Create core database tables

**Files:**
- Create: `supabase/migrations/20260425000001_file_system_tables.sql`

- [ ] **Step 1: Write the folders table**

```sql
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
```

- [ ] **Step 2: Write the files table**

Append to the same migration file:

```sql
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
```

- [ ] **Step 3: Write the post_file_links table**

Append to the same migration file:

```sql
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
```

- [ ] **Step 4: Write the file_deletions table**

Append to the same migration file:

```sql
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
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260425000001_file_system_tables.sql
git commit -m "feat(db): create folders, files, post_file_links, file_deletions tables"
```

---

## Task 2: Create database triggers and RPC functions

**Files:**
- Create: `supabase/migrations/20260425000002_file_system_triggers.sql`

- [ ] **Step 1: Write auto-folder sync triggers for clientes**

```sql
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
```

- [ ] **Step 2: Write auto-folder sync triggers for workflows**

Append to the same migration file:

```sql
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
```

- [ ] **Step 3: Write auto-folder sync triggers for workflow_posts**

Append to the same migration file:

```sql
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
```

- [ ] **Step 4: Write reference count triggers on post_file_links**

Append to the same migration file:

```sql
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
```

- [ ] **Step 5: Write auto-cover triggers on post_file_links**

Append to the same migration file:

```sql
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
```

- [ ] **Step 6: Write file deletion queue trigger**

Append to the same migration file:

```sql
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
```

- [ ] **Step 7: Write quota enforcement RPC and triggers**

Append to the same migration file:

```sql
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
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260425000002_file_system_triggers.sql
git commit -m "feat(db): add auto-folder sync, reference count, cover, quota, and deletion triggers"
```

---

## Task 3: Backfill migration from post_media

**Files:**
- Create: `supabase/migrations/20260425000003_file_system_backfill.sql`

- [ ] **Step 1: Write the backfill migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260425000003_file_system_backfill.sql
git commit -m "feat(db): backfill folders from clients/workflows/posts, migrate post_media to files"
```

---

## Task 4: TypeScript types for the file system

**Files:**
- Create: `apps/crm/src/pages/arquivos/types.ts`
- Modify: `apps/crm/src/store.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/crm/src/pages/arquivos/types.ts

export interface Folder {
  id: number;
  conta_id: string;
  parent_id: number | null;
  name: string;
  source: 'system' | 'user';
  source_type: 'client' | 'workflow' | 'post' | null;
  source_id: number | null;
  name_overridden: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  file_count?: number;
  subfolder_count?: number;
}

export interface FileRecord {
  id: number;
  conta_id: string;
  folder_id: number | null;
  r2_key: string;
  thumbnail_r2_key: string | null;
  name: string;
  kind: 'image' | 'video' | 'document';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  blur_data_url: string | null;
  uploaded_by: string | null;
  reference_count: number;
  created_at: string;
  url?: string;
  thumbnail_url?: string | null;
}

export interface PostFileLink {
  id: number;
  post_id: number;
  file_id: number;
  conta_id: string;
  is_cover: boolean;
  sort_order: number;
  created_at: string;
}

export interface FolderContents {
  folder: Folder | null;
  subfolders: Folder[];
  files: FileRecord[];
  breadcrumbs: Pick<Folder, 'id' | 'name'>[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/crm/src/pages/arquivos/types.ts
git commit -m "feat: add TypeScript types for file system"
```

---

## Task 5: file-upload-url edge function

**Files:**
- Create: `supabase/functions/file-upload-url/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/file-upload-url/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signPutUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_SIZE = 400 * 1024 * 1024;

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "application/pdf": "pdf", "application/zip": "zip",
  };
  return map[mime] ?? "bin";
}

function classifyKind(mime: string): "image" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    folder_id?: number | null;
    filename: string;
    mime_type: string;
    size_bytes: number;
    thumbnail?: { mime_type: string; size_bytes: number };
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { folder_id, filename, mime_type, size_bytes, thumbnail } = body;
  if (!filename || !mime_type || !size_bytes) return json({ error: "Missing fields" }, 400);
  if (size_bytes <= 0 || size_bytes > MAX_SIZE) return json({ error: "size_bytes out of range" }, 400);

  const kind = classifyKind(mime_type);

  if (kind === "video" && !thumbnail) return json({ error: "video requires thumbnail" }, 400);
  if (thumbnail) {
    if (!thumbnail.mime_type.startsWith("image/")) return json({ error: "thumbnail must be an image" }, 400);
    if (thumbnail.size_bytes <= 0 || thumbnail.size_bytes > 10 * 1024 * 1024) {
      return json({ error: "thumbnail size out of range" }, 400);
    }
  }

  if (folder_id) {
    const { data: folder } = await svc.from("folders").select("conta_id").eq("id", folder_id).single();
    if (!folder || folder.conta_id !== profile.conta_id) return json({ error: "Folder not found" }, 404);
  }

  const { data: ws } = await svc.from("workspaces")
    .select("storage_quota_bytes, storage_used_bytes")
    .eq("id", profile.conta_id).single();
  const quota = ws?.storage_quota_bytes ?? null;
  if (quota !== null) {
    const used = Number(ws?.storage_used_bytes ?? 0);
    const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
    if (used + needed > quota) {
      return json({ error: "quota_exceeded", used, quota }, 413);
    }
  }

  const fileId = crypto.randomUUID();
  const ext = extFromMime(mime_type);
  const r2_key = `contas/${profile.conta_id}/files/${fileId}.${ext}`;
  const upload_url = await signPutUrl(r2_key, mime_type);

  let thumbnail_r2_key: string | undefined;
  let thumbnail_upload_url: string | undefined;
  if (thumbnail) {
    thumbnail_r2_key = `contas/${profile.conta_id}/files/${fileId}.thumb.${extFromMime(thumbnail.mime_type)}`;
    thumbnail_upload_url = await signPutUrl(thumbnail_r2_key, thumbnail.mime_type);
  }

  return json({
    file_id: fileId, upload_url, r2_key, kind,
    thumbnail_upload_url, thumbnail_r2_key,
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/file-upload-url/index.ts
git commit -m "feat: add file-upload-url edge function"
```

---

## Task 6: file-upload-finalize edge function

**Files:**
- Create: `supabase/functions/file-upload-finalize/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/file-upload-finalize/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, signGetUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    file_id: string;
    r2_key: string;
    thumbnail_r2_key?: string;
    kind: "image" | "video" | "document";
    mime_type: string;
    size_bytes: number;
    name: string;
    folder_id?: number | null;
    width?: number;
    height?: number;
    duration_seconds?: number;
    blur_data_url?: string;
    post_id?: number;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const expectedPrefix = `contas/${profile.conta_id}/files/`;
  if (!body.r2_key.startsWith(expectedPrefix)) return json({ error: "invalid r2_key" }, 400);
  if (body.thumbnail_r2_key && !body.thumbnail_r2_key.startsWith(expectedPrefix)) {
    return json({ error: "invalid thumbnail_r2_key" }, 400);
  }

  const head = await headObject(body.r2_key);
  if (!head) return json({ error: "object not found" }, 400);
  if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);

  if (body.kind === "video") {
    if (!body.thumbnail_r2_key) return json({ error: "video requires thumbnail_r2_key" }, 400);
    const thumbHead = await headObject(body.thumbnail_r2_key);
    if (!thumbHead) return json({ error: "thumbnail not found" }, 400);
  }

  if (body.folder_id) {
    const { data: folder } = await svc.from("folders").select("conta_id").eq("id", body.folder_id).single();
    if (!folder || folder.conta_id !== profile.conta_id) return json({ error: "Folder not found" }, 404);
  }

  const { data: inserted, error: insErr } = await svc.rpc("file_insert_with_quota", {
    p: {
      conta_id: profile.conta_id,
      folder_id: body.folder_id ?? "",
      r2_key: body.r2_key,
      thumbnail_r2_key: body.thumbnail_r2_key ?? "",
      name: body.name,
      kind: body.kind,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      width: body.width ?? "",
      height: body.height ?? "",
      duration_seconds: body.duration_seconds ?? "",
      uploaded_by: user.id,
    },
  }).single();

  if (insErr || !inserted) {
    const msg = insErr?.message ?? "insert failed";
    return json({ error: msg }, msg.includes("quota_exceeded") ? 413 : 500);
  }

  if (body.blur_data_url && typeof body.blur_data_url === "string" && body.blur_data_url.startsWith("data:")) {
    await svc.from("files").update({ blur_data_url: body.blur_data_url }).eq("id", (inserted as any).id);
  }

  if (body.post_id) {
    if (body.kind === "document") return json({ error: "documents cannot be linked to posts" }, 400);

    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", body.post_id).single();
    if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

    await svc.from("post_file_links").insert({
      post_id: body.post_id,
      file_id: (inserted as any).id,
      conta_id: profile.conta_id,
    });
  }

  const url = await signUrl(body.r2_key);
  const thumbnail_url = body.thumbnail_r2_key ? await signUrl(body.thumbnail_r2_key) : null;

  return json({ ...inserted, url, thumbnail_url, blur_data_url: body.blur_data_url ?? null });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/file-upload-finalize/index.ts
git commit -m "feat: add file-upload-finalize edge function"
```

---

## Task 7: file-manage edge function

**Files:**
- Create: `supabase/functions/file-manage/index.ts`

- [ ] **Step 1: Write the edge function**

```typescript
// supabase/functions/file-manage/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = { ...buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("file-manage");
  const resource = parts[idx + 1]; // 'folders' or 'files' or 'links'
  const idStr = parts[idx + 2];
  const contaId = profile.conta_id;

  // ─── FOLDERS ──────────────────────────────────────────────────
  if (resource === "folders") {
    // GET /folders?parent_id=... → list folder contents
    if (req.method === "GET") {
      const parentId = url.searchParams.get("parent_id");
      const parentFilter = parentId ? Number(parentId) : null;

      const foldersQ = svc.from("folders").select("*").eq("conta_id", contaId);
      if (parentFilter) foldersQ.eq("parent_id", parentFilter);
      else foldersQ.is("parent_id", null);
      foldersQ.order("source", { ascending: true }).order("name", { ascending: true });

      const filesQ = svc.from("files").select("*").eq("conta_id", contaId);
      if (parentFilter) filesQ.eq("folder_id", parentFilter);
      else filesQ.is("folder_id", null);
      filesQ.order("created_at", { ascending: false });

      const [{ data: subfolders }, { data: files }] = await Promise.all([foldersQ, filesQ]);

      const signedFiles = await Promise.all((files ?? []).map(async (f: any) => ({
        ...f,
        url: f.kind !== "document" ? await signUrl(f.r2_key) : null,
        thumbnail_url: f.thumbnail_r2_key ? await signUrl(f.thumbnail_r2_key) : null,
      })));

      let breadcrumbs: { id: number; name: string }[] = [];
      if (parentFilter) {
        let currentId: number | null = parentFilter;
        while (currentId) {
          const { data: f } = await svc.from("folders").select("id, name, parent_id").eq("id", currentId).single();
          if (!f) break;
          breadcrumbs.unshift({ id: f.id, name: f.name });
          currentId = f.parent_id;
        }
      }

      let folder: any = null;
      if (parentFilter) {
        const { data: f } = await svc.from("folders").select("*").eq("id", parentFilter).single();
        folder = f;
      }

      return json({ folder, subfolders: subfolders ?? [], files: signedFiles, breadcrumbs });
    }

    // POST /folders → create folder
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { name, parent_id } = body as { name?: string; parent_id?: number | null };
      if (!name) return json({ error: "name required" }, 400);

      if (parent_id) {
        const { data: parent } = await svc.from("folders").select("conta_id").eq("id", parent_id).single();
        if (!parent || parent.conta_id !== contaId) return json({ error: "Parent folder not found" }, 404);
      }

      const { data: created, error: createErr } = await svc.from("folders").insert({
        conta_id: contaId,
        parent_id: parent_id ?? null,
        name,
        source: "user",
      }).select().single();

      if (createErr) return json({ error: createErr.message }, 500);
      return json(created, 201);
    }

    // PATCH /folders/:id → rename or move
    if (req.method === "PATCH" && idStr) {
      const folderId = Number(idStr);
      const { data: folder } = await svc.from("folders").select("*").eq("id", folderId).single();
      if (!folder || folder.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (typeof body.name === "string") {
        patch.name = body.name;
        if (folder.source === "system") patch.name_overridden = true;
      }
      if (body.parent_id !== undefined) {
        patch.parent_id = body.parent_id;
      }

      const { data: updated, error: updErr } = await svc.from("folders").update(patch).eq("id", folderId).select().single();
      if (updErr) return json({ error: updErr.message }, 500);
      return json(updated);
    }

    // DELETE /folders/:id
    if (req.method === "DELETE" && idStr) {
      const folderId = Number(idStr);
      const { data: folder } = await svc.from("folders").select("source, conta_id").eq("id", folderId).single();
      if (!folder || folder.conta_id !== contaId) return json({ error: "Folder not found" }, 404);

      if (folder.source === "system") {
        return json({ error: "System folders cannot be deleted" }, 403);
      }

      const { error: delErr } = await svc.from("folders").delete().eq("id", folderId);
      if (delErr) return json({ error: delErr.message }, 500);
      return json({ ok: true });
    }
  }

  // ─── FILES ────────────────────────────────────────────────────
  if (resource === "files") {
    // PATCH /files/:id → rename or move
    if (req.method === "PATCH" && idStr) {
      const fileId = Number(idStr);
      const { data: file } = await svc.from("files").select("conta_id").eq("id", fileId).single();
      if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string") patch.name = body.name;
      if (body.folder_id !== undefined) patch.folder_id = body.folder_id;

      if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

      const { data: updated, error: updErr } = await svc.from("files").update(patch).eq("id", fileId).select().single();
      if (updErr) return json({ error: updErr.message }, 500);
      return json(updated);
    }

    // DELETE /files/:id
    if (req.method === "DELETE" && idStr) {
      const fileId = Number(idStr);
      const { data: file } = await svc.from("files").select("conta_id, reference_count").eq("id", fileId).single();
      if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);

      if (file.reference_count > 0) {
        const { data: links } = await svc.from("post_file_links")
          .select("post_id, workflow_posts(titulo, workflow_id, workflows(titulo))")
          .eq("file_id", fileId);
        return json({
          error: "file_in_use",
          reference_count: file.reference_count,
          linked_posts: (links ?? []).map((l: any) => ({
            post_id: l.post_id,
            post_titulo: l.workflow_posts?.titulo,
            workflow_titulo: l.workflow_posts?.workflows?.titulo,
          })),
        }, 409);
      }

      const { error: delErr } = await svc.from("files").delete().eq("id", fileId);
      if (delErr) return json({ error: delErr.message }, 500);
      return json({ ok: true });
    }
  }

  // ─── LINKS ────────────────────────────────────────────────────
  if (resource === "links") {
    // POST /links → link file to post
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { post_id, file_id } = body as { post_id?: number; file_id?: number };
      if (!post_id || !file_id) return json({ error: "post_id and file_id required" }, 400);

      const { data: file } = await svc.from("files").select("conta_id, kind").eq("id", file_id).single();
      if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
      if (file.kind === "document") return json({ error: "Documents cannot be linked to posts" }, 400);

      const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", post_id).single();
      if (!post || post.conta_id !== contaId) return json({ error: "Post not found" }, 404);

      const { data: link, error: linkErr } = await svc.from("post_file_links").insert({
        post_id, file_id, conta_id: contaId,
      }).select().single();

      if (linkErr) {
        if (linkErr.message.includes("duplicate")) return json({ error: "Already linked" }, 409);
        return json({ error: linkErr.message }, 500);
      }
      return json(link, 201);
    }

    // DELETE /links/:id → unlink file from post
    if (req.method === "DELETE" && idStr) {
      const linkId = Number(idStr);
      const { data: link } = await svc.from("post_file_links").select("conta_id").eq("id", linkId).single();
      if (!link || link.conta_id !== contaId) return json({ error: "Link not found" }, 404);

      const { error: delErr } = await svc.from("post_file_links").delete().eq("id", linkId);
      if (delErr) return json({ error: delErr.message }, 500);
      return json({ ok: true });
    }

    // GET /links?post_id=... → list links for a post (with file data)
    if (req.method === "GET") {
      const postId = Number(url.searchParams.get("post_id"));
      if (!postId) return json({ error: "post_id required" }, 400);

      const { data: links } = await svc.from("post_file_links")
        .select("*, files(*)")
        .eq("post_id", postId)
        .eq("conta_id", contaId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      const withUrls = await Promise.all((links ?? []).map(async (l: any) => {
        const f = l.files;
        return {
          ...l,
          files: {
            ...f,
            url: f.kind !== "document" ? await signUrl(f.r2_key) : null,
            thumbnail_url: f.thumbnail_r2_key ? await signUrl(f.thumbnail_r2_key) : null,
          },
        };
      }));

      return json({ links: withUrls });
    }

    // PATCH /links/:id → update sort_order or is_cover
    if (req.method === "PATCH" && idStr) {
      const linkId = Number(idStr);
      const { data: link } = await svc.from("post_file_links").select("conta_id").eq("id", linkId).single();
      if (!link || link.conta_id !== contaId) return json({ error: "Link not found" }, 404);

      const body = await req.json().catch(() => ({}));

      if (body.is_cover === true) {
        const { error: swapErr } = await svc.rpc("post_file_link_set_cover", { p_link_id: linkId });
        if (swapErr) return json({ error: swapErr.message }, 500);
        const { data: updated } = await svc.from("post_file_links").select("*").eq("id", linkId).single();
        return json(updated);
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;

      if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

      const { data: updated, error: updErr } = await svc.from("post_file_links").update(patch).eq("id", linkId).select().single();
      if (updErr) return json({ error: updErr.message }, 500);
      return json(updated);
    }
  }

  return json({ error: "Not found" }, 404);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/file-manage/index.ts
git commit -m "feat: add file-manage edge function (CRUD for files, folders, links)"
```

---

## Task 8: Update post-media-manage as adapter

**Files:**
- Modify: `supabase/functions/post-media-manage/index.ts`

- [ ] **Step 1: Rewrite post-media-manage to query new tables**

Replace the entire contents of `supabase/functions/post-media-manage/index.ts` with:

```typescript
// supabase/functions/post-media-manage/index.ts
// Adapter: queries post_file_links + files, returns legacy PostMedia-shaped records.
// link.id serves as the legacy "media ID".
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[mime as "image/jpeg"] ?? "bin";
}

function toLegacy(link: any, file: any, url: string, thumbnailUrl: string | null) {
  return {
    id: link.id,
    post_id: link.post_id,
    conta_id: link.conta_id,
    r2_key: file.r2_key,
    thumbnail_r2_key: file.thumbnail_r2_key,
    kind: file.kind,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    original_filename: file.name,
    width: file.width,
    height: file.height,
    duration_seconds: file.duration_seconds,
    is_cover: link.is_cover,
    sort_order: link.sort_order,
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    url,
    thumbnail_url: thumbnailUrl,
  };
}

Deno.serve(async (req) => {
  const cors = { ...buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  const requestUrl = new URL(req.url);
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("post-media-manage");
  const idStr = parts[fnIdx + 1];
  const sub = parts[fnIdx + 2];

  if (req.method === "GET") {
    const workflowIdsParam = requestUrl.searchParams.get("workflow_ids");
    if (workflowIdsParam) {
      const workflowIds = workflowIdsParam.split(",").map(Number).filter((n) => Number.isFinite(n));
      if (workflowIds.length === 0) return json({ covers: [] });

      const { data: posts } = await svc.from("workflow_posts")
        .select("id, workflow_id, ordem")
        .in("workflow_id", workflowIds)
        .eq("conta_id", profile.conta_id)
        .order("ordem", { ascending: true });
      if (!posts || posts.length === 0) return json({ covers: [] });

      const postIds = posts.map((p: any) => p.id);
      const { data: coverLinks } = await svc.from("post_file_links")
        .select("*, files(*)")
        .in("post_id", postIds)
        .eq("is_cover", true);

      const postById = new Map(posts.map((p: any) => [p.id, p]));
      const sorted = (coverLinks ?? []).slice().sort((a: any, b: any) => {
        const pa = postById.get(a.post_id);
        const pb = postById.get(b.post_id);
        return (pa?.ordem ?? 0) - (pb?.ordem ?? 0) || a.post_id - b.post_id;
      });

      const byWorkflow = new Map<number, any[]>();
      for (const link of sorted) {
        const post = postById.get(link.post_id);
        if (!post) continue;
        const arr = byWorkflow.get(post.workflow_id) ?? [];
        arr.push(link);
        byWorkflow.set(post.workflow_id, arr);
      }

      const result = await Promise.all(Array.from(byWorkflow.entries()).map(async ([workflow_id, links]) => ({
        workflow_id,
        media: await Promise.all(links.map(async (l: any) => {
          const f = l.files;
          const u = await signUrl(f.r2_key);
          const tu = f.thumbnail_r2_key ? await signUrl(f.thumbnail_r2_key) : null;
          return toLegacy(l, f, u, tu);
        })),
      })));
      return json({ covers: result });
    }

    const postId = Number(requestUrl.searchParams.get("post_id"));
    if (!postId) return json({ error: "post_id required" }, 400);

    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", postId).single();
    if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

    const { data: links } = await svc.from("post_file_links")
      .select("*, files(*)")
      .eq("post_id", postId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    const media = await Promise.all((links ?? []).map(async (l: any) => {
      const f = l.files;
      const u = await signGetUrl(f.r2_key, 900);
      const tu = f.thumbnail_r2_key ? await signGetUrl(f.thumbnail_r2_key, 900) : null;
      return toLegacy(l, f, u, tu);
    }));
    return json({ media });
  }

  if (!idStr) return json({ error: "id required" }, 400);
  const linkId = Number(idStr);
  if (!linkId) return json({ error: "invalid id" }, 400);

  const { data: link } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
  if (!link || link.conta_id !== profile.conta_id) return json({ error: "Not found" }, 404);
  const file = (link as any).files;

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));

    if (body.is_cover === true) {
      const { error: swapErr } = await svc.rpc("post_file_link_set_cover", { p_link_id: linkId });
      if (swapErr) return json({ error: swapErr.message }, 500);
    }

    if (typeof body.sort_order === "number") {
      await svc.from("post_file_links").update({ sort_order: body.sort_order }).eq("id", linkId);
    }

    if (body.thumbnail_r2_key && typeof body.thumbnail_r2_key === "string") {
      if (file.thumbnail_r2_key && file.thumbnail_r2_key !== body.thumbnail_r2_key) {
        await svc.from("file_deletions").insert({ r2_key: file.thumbnail_r2_key });
      }
      await svc.from("files").update({ thumbnail_r2_key: body.thumbnail_r2_key }).eq("id", file.id);
    }

    const { data: updatedLink } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
    const uf = (updatedLink as any).files;
    const u = await signUrl(uf.r2_key);
    const tu = uf.thumbnail_r2_key ? await signUrl(uf.thumbnail_r2_key) : null;
    return json(toLegacy(updatedLink, uf, u, tu));
  }

  if (req.method === "DELETE") {
    const { error: delErr } = await svc.from("post_file_links").delete().eq("id", linkId);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true });
  }

  if (req.method === "POST" && sub === "thumbnail") {
    if (file.kind !== "video") return json({ error: "only videos have thumbnails" }, 400);
    const body = await req.json().catch(() => ({}));
    const mime = String(body.mime_type ?? "");
    if (!THUMB_MIME.has(mime)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    const key = `contas/${profile.conta_id}/files/${crypto.randomUUID()}.thumb.${extFromMime(mime)}`;
    const upload_url = await signPutUrl(key, mime);
    return json({ thumbnail_r2_key: key, thumbnail_upload_url: upload_url });
  }

  return json({ error: "Method not allowed" }, 405);
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/post-media-manage/index.ts
git commit -m "refactor: rewrite post-media-manage as adapter over post_file_links + files"
```

---

## Task 9: Update hub-posts to join through new tables

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`

- [ ] **Step 1: Update the media query in handler.ts**

In `supabase/functions/hub-posts/handler.ts`, replace lines 102–124 (the `post_media` query and `mediaWithUrls` mapping) with:

```typescript
    const { data: mediaLinks } = postIds.length > 0
      ? await db
          .from("post_file_links")
          .select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url)")
          .in("post_id", postIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
      : { data: [] };

    const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(async (link: any) => {
      const f = link.files;
      return {
        id: link.id,
        post_id: link.post_id,
        kind: f.kind,
        mime_type: f.mime_type,
        width: f.width,
        height: f.height,
        duration_seconds: f.duration_seconds,
        is_cover: link.is_cover,
        sort_order: link.sort_order,
        blur_data_url: f.blur_data_url ?? null,
        url: await deps.signGetUrl(f.r2_key, 3600),
        thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
      };
    }));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts
git commit -m "refactor: update hub-posts to join through post_file_links + files"
```

---

## Task 10: Update cleanup cron to drain file_deletions

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts`

- [ ] **Step 1: Add file_deletions draining alongside post_media_deletions**

In `supabase/functions/post-media-cleanup-cron/index.ts`, update the `run` handler (after the existing `post_media_deletions` loop, before the orphan cleanup) to also drain `file_deletions`. Replace the run handler (lines 15–63) with:

```typescript
    run: async (_req, json) => {
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      let deleted = 0;
      let failed = 0;

      // Drain post_media_deletions (legacy)
      const { data: legacyPending } = await svc
        .from("post_media_deletions")
        .select("id, r2_key, attempts")
        .lt("attempts", 6)
        .order("enqueued_at", { ascending: true })
        .limit(500);

      for (const row of legacyPending ?? []) {
        try {
          await deleteObject(row.r2_key);
          await svc.from("post_media_deletions").delete().eq("id", row.id);
          deleted++;
        } catch (e) {
          failed++;
          await svc.from("post_media_deletions")
            .update({ attempts: (row.attempts ?? 0) + 1, last_error: (e as Error).message })
            .eq("id", row.id);
        }
      }

      // Drain file_deletions (new)
      const { data: filePending } = await svc
        .from("file_deletions")
        .select("id, r2_key, thumbnail_r2_key, attempts")
        .lt("attempts", 5)
        .lte("next_retry_at", new Date().toISOString())
        .order("queued_at", { ascending: true })
        .limit(500);

      for (const row of filePending ?? []) {
        try {
          await deleteObject(row.r2_key);
          if (row.thumbnail_r2_key) await deleteObject(row.thumbnail_r2_key);
          await svc.from("file_deletions").delete().eq("id", row.id);
          deleted++;
        } catch (e) {
          failed++;
          const nextAttempts = (row.attempts ?? 0) + 1;
          const backoffSeconds = Math.pow(2, nextAttempts) * 60;
          await svc.from("file_deletions").update({
            attempts: nextAttempts,
            last_error: (e as Error).message,
            next_retry_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          }).eq("id", row.id);
        }
      }

      // Orphan cleanup
      const orphanCandidates = await listOrphanKeys("contas/", 24 * 60 * 60 * 1000);
      let orphansDeleted = 0;
      if (orphanCandidates.length > 0) {
        const [byMain, byThumb, byFileMain, byFileThumb] = await Promise.all([
          svc.from("post_media").select("r2_key, thumbnail_r2_key").in("r2_key", orphanCandidates),
          svc.from("post_media").select("r2_key, thumbnail_r2_key").in("thumbnail_r2_key", orphanCandidates),
          svc.from("files").select("r2_key, thumbnail_r2_key").in("r2_key", orphanCandidates),
          svc.from("files").select("r2_key, thumbnail_r2_key").in("thumbnail_r2_key", orphanCandidates),
        ]);
        const known = new Set<string>();
        for (const row of [...(byMain.data ?? []), ...(byThumb.data ?? []), ...(byFileMain.data ?? []), ...(byFileThumb.data ?? [])]) {
          if (row.r2_key) known.add(row.r2_key);
          if (row.thumbnail_r2_key) known.add(row.thumbnail_r2_key);
        }
        for (const key of orphanCandidates) {
          if (known.has(key)) continue;
          try { await deleteObject(key); orphansDeleted++; } catch { /* retry next run */ }
        }
      }

      return json({ deleted, failed, orphansDeleted });
    },
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/post-media-cleanup-cron/index.ts
git commit -m "feat: update cleanup cron to drain file_deletions alongside post_media_deletions"
```

---

## Task 11: Client-side file service

**Files:**
- Create: `apps/crm/src/services/fileService.ts`

- [ ] **Step 1: Write the file service**

```typescript
// apps/crm/src/services/fileService.ts
import { supabase } from '../lib/supabase';
import type { Folder, FileRecord, FolderContents, PostFileLink } from '../pages/arquivos/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export type UploadProgress = { loaded: number; total: number };

async function callFn<T>(
  name: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: Record<string, string>,
  pathSuffix = '',
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = new URL(`${SUPABASE_URL}/functions/v1/${name}${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function putWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

// ─── FOLDER OPERATIONS ─────────────────────────────────────────

export async function getFolderContents(parentId: number | null): Promise<FolderContents> {
  const query = parentId ? { parent_id: String(parentId) } : {};
  return callFn<FolderContents>('file-manage', 'GET', undefined, query, '/folders');
}

export async function createFolder(name: string, parentId: number | null): Promise<Folder> {
  return callFn<Folder>('file-manage', 'POST', { name, parent_id: parentId }, undefined, '/folders');
}

export async function renameFolder(folderId: number, name: string): Promise<Folder> {
  return callFn<Folder>('file-manage', 'PATCH', { name }, undefined, `/folders/${folderId}`);
}

export async function moveFolder(folderId: number, newParentId: number | null): Promise<Folder> {
  return callFn<Folder>('file-manage', 'PATCH', { parent_id: newParentId }, undefined, `/folders/${folderId}`);
}

export async function deleteFolder(folderId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/folders/${folderId}`);
}

// ─── FILE OPERATIONS ────────────────────────────────────────────

export async function uploadFile(args: {
  file: File;
  folderId: number | null;
  thumbnail?: File;
  onProgress?: (p: UploadProgress) => void;
  postId?: number;
}): Promise<FileRecord> {
  const { file, folderId, thumbnail, onProgress, postId } = args;

  const signed = await callFn<{
    file_id: string; upload_url: string; r2_key: string; kind: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('file-upload-url', 'POST', {
    folder_id: folderId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail: thumbnail ? { mime_type: thumbnail.type, size_bytes: thumbnail.size } : undefined,
  });

  const uploads: Promise<void>[] = [putWithProgress(signed.upload_url, file, onProgress)];
  if (thumbnail && signed.thumbnail_upload_url) {
    uploads.push(putWithProgress(signed.thumbnail_upload_url, thumbnail));
  }
  await Promise.all(uploads);

  let width: number | undefined;
  let height: number | undefined;
  let duration_seconds: number | undefined;
  let blur_data_url: string | undefined;

  if (signed.kind === 'image') {
    const dims = await probeImage(file);
    width = dims.width;
    height = dims.height;
    blur_data_url = await generateBlurDataUrl(file).catch(() => undefined);
  } else if (signed.kind === 'video') {
    const dims = await probeVideo(file);
    width = dims.width;
    height = dims.height;
    duration_seconds = dims.duration_seconds;
  }

  return callFn<FileRecord>('file-upload-finalize', 'POST', {
    file_id: signed.file_id,
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    kind: signed.kind,
    mime_type: file.type,
    size_bytes: file.size,
    name: file.name,
    folder_id: folderId,
    width, height, duration_seconds, blur_data_url,
    post_id: postId,
  });
}

export async function renameFile(fileId: number, name: string): Promise<FileRecord> {
  return callFn<FileRecord>('file-manage', 'PATCH', { name }, undefined, `/files/${fileId}`);
}

export async function moveFile(fileId: number, folderId: number | null): Promise<FileRecord> {
  return callFn<FileRecord>('file-manage', 'PATCH', { folder_id: folderId }, undefined, `/files/${fileId}`);
}

export async function deleteFile(fileId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/files/${fileId}`);
}

// ─── LINK OPERATIONS ────────────────────────────────────────────

export async function linkFileToPost(fileId: number, postId: number): Promise<PostFileLink> {
  return callFn<PostFileLink>('file-manage', 'POST', { file_id: fileId, post_id: postId }, undefined, '/links');
}

export async function unlinkFileFromPost(linkId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/links/${linkId}`);
}

export async function getPostLinks(postId: number) {
  return callFn<{ links: (PostFileLink & { files: FileRecord })[] }>(
    'file-manage', 'GET', undefined, { post_id: String(postId) }, '/links'
  );
}

// ─── MEDIA HELPERS (reused from postMedia.ts) ───────────────────

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function probeVideo(file: File): Promise<{ width: number; height: number; duration_seconds: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: vid.videoWidth, height: vid.videoHeight, duration_seconds: Math.round(vid.duration) });
    };
    vid.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    vid.src = url;
  });
}

const BLUR_SIZE = 16;
function generateBlurDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = ratio >= 1 ? BLUR_SIZE : Math.round(BLUR_SIZE * ratio);
        const h = ratio >= 1 ? Math.round(BLUR_SIZE / ratio) : BLUR_SIZE;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.2));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/crm/src/services/fileService.ts
git commit -m "feat: add client-side file service for file/folder/link operations"
```

---

## Task 12: Add /arquivos route and sidebar nav item

**Files:**
- Modify: `apps/crm/src/App.tsx`
- Modify: `apps/crm/src/components/layout/Sidebar.tsx`
- Create: `apps/crm/src/pages/arquivos/ArquivosPage.tsx` (minimal placeholder)

- [ ] **Step 1: Create a placeholder ArquivosPage**

```typescript
// apps/crm/src/pages/arquivos/ArquivosPage.tsx
export default function ArquivosPage() {
  return <div style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}><h1>Arquivos</h1></div>;
}
```

- [ ] **Step 2: Add the lazy import and route in App.tsx**

In `apps/crm/src/App.tsx`, add after line 35 (the `IdeiasPage` import):

```typescript
const ArquivosPage = lazy(() => import('./pages/arquivos/ArquivosPage'));
```

Add a route after the `/entregas` route (line 80):

```typescript
              <Route path="/arquivos" element={<ArquivosPage />} />
```

- [ ] **Step 3: Add the sidebar nav item**

In `apps/crm/src/components/layout/Sidebar.tsx`, add to the `gestao` group items array (after the `entregas` item at line 25):

```typescript
      { id: 'arquivos', route: '/arquivos', label: 'Arquivos', icon: 'ph-folder-open' },
```

- [ ] **Step 4: Run typecheck**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/App.tsx apps/crm/src/components/layout/Sidebar.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat: add /arquivos route and sidebar nav item"
```

---

## Task 13: Build the ArquivosPage with folder tree, file grid, and breadcrumbs

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FolderTree.tsx`
- Create: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Create: `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

This task builds the core file browser UI. It's the largest UI task — implement each component file, then wire them together in ArquivosPage.

- [ ] **Step 1: Create FolderTree component**

Create `apps/crm/src/pages/arquivos/components/FolderTree.tsx` — a recursive collapsible tree that:
- Fetches folder contents via `getFolderContents(parentId)` from `fileService`
- Shows AUTO badge for `source === 'system'` folders
- Highlights the currently selected folder
- Has a "+ Nova pasta" button at the bottom
- Uses `useQuery` with key `['folders', parentId]`
- Props: `{ selectedFolderId: number | null; onSelectFolder: (id: number | null) => void }`
- Use `lucide-react` icons: `Folder`, `FolderOpen`, `ChevronRight`, `ChevronDown`, `Plus`

- [ ] **Step 2: Create Breadcrumbs component**

Create `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx`:
- Props: `{ breadcrumbs: { id: number; name: string }[]; onNavigate: (folderId: number | null) => void }`
- Renders "Todos os Arquivos" as the root, then each breadcrumb as a clickable link
- Last breadcrumb is not clickable (current location)
- Use `ChevronRight` from lucide-react as separator

- [ ] **Step 3: Create FileGrid component**

Create `apps/crm/src/pages/arquivos/components/FileGrid.tsx`:
- Props: `{ files: FileRecord[]; subfolders: Folder[]; onOpenFolder: (id: number) => void; onFileAction: (action: string, file: FileRecord) => void; viewMode: 'grid' | 'list' }`
- Grid mode: renders folder cards first, then file thumbnail cards
- List mode: renders a table with columns: Name, Kind, Size, Date, Links
- Folder cards show folder icon, name, file count, AUTO badge if system
- File cards show thumbnail preview (for images/videos), file icon (for documents), name, size, reference count badge
- Use `formatDistanceToNow` from `date-fns` for dates
- Format file sizes with a `formatBytes` utility (e.g., "2.4 MB")

- [ ] **Step 4: Wire everything together in ArquivosPage**

Rewrite `apps/crm/src/pages/arquivos/ArquivosPage.tsx`:
- State: `currentFolderId: number | null` (null = root)
- State: `viewMode: 'grid' | 'list'`
- Query: `useQuery(['folder-contents', currentFolderId], () => getFolderContents(currentFolderId))`
- Layout: left panel (260px) with FolderTree, right panel with Breadcrumbs + toolbar (upload button, view toggle) + FileGrid
- Upload button opens a file input (handled in Task 14)

- [ ] **Step 5: Run typecheck and dev server**

```bash
npm run build
npm run dev
```

Verify: navigate to `/arquivos`, see folder tree on left, empty file grid on right (no data yet without migration).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/arquivos/
git commit -m "feat: build ArquivosPage with folder tree, file grid, and breadcrumbs"
```

---

## Task 14: Add FileUploader component with drag-and-drop

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FileUploader.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Create FileUploader component**

Create `apps/crm/src/pages/arquivos/components/FileUploader.tsx`:
- Props: `{ folderId: number | null; onUploadComplete: () => void }`
- Hidden file input with `multiple` attribute
- Drag-and-drop zone that wraps the file grid area (shows overlay on drag)
- For each file: calls `uploadFile({ file, folderId, onProgress })` from `fileService`
- For video files: shows a thumbnail selection dialog before uploading
- Progress bar UI during upload (uses `UploadProgress` type)
- Uses `useMutation` from TanStack Query, invalidates `['folder-contents', folderId]` on success
- Toast notifications via `toast()` from `sonner` on success/error

- [ ] **Step 2: Integrate into ArquivosPage**

Add the upload button in the toolbar that triggers the file input. Wrap the content area with the drag-and-drop zone from FileUploader.

- [ ] **Step 3: Run typecheck**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FileUploader.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat: add FileUploader with drag-and-drop and progress tracking"
```

---

## Task 15: Add FileContextMenu and folder/file actions

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Create FileContextMenu component**

Create `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx`:
- Uses shadcn `ContextMenu` component (or implement with Radix `ContextMenu`)
- For folders: Rename, Move (if user folder), Delete (if user folder, blocked for system with toast)
- For files: Rename, Move, Delete (blocked if reference_count > 0 — show linked posts), Download, Copy link
- Each action triggers the appropriate `fileService` function
- Rename: inline editing with input field
- Delete: confirmation dialog with sonner toast
- Props: `{ item: Folder | FileRecord; type: 'folder' | 'file'; onAction: () => void }`

- [ ] **Step 2: Integrate context menu into FileGrid and FolderTree**

Wrap folder/file items in FileGrid with the context menu. Add right-click handling.

- [ ] **Step 3: Add rename dialog and delete confirmation**

Use shadcn `Dialog` for rename modal. Use shadcn `AlertDialog` for delete confirmation. Show linked posts list when trying to delete a file with `reference_count > 0`.

- [ ] **Step 4: Run typecheck**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FileContextMenu.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FileGrid.tsx apps/crm/src/pages/arquivos/components/FolderTree.tsx
git commit -m "feat: add context menu with rename, move, delete, download actions"
```

---

## Task 16: Build FilePickerModal

**Files:**
- Create: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`

- [ ] **Step 1: Create FilePickerModal component**

Create `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`:
- Props: `{ open: boolean; onClose: () => void; onSelect: (fileIds: number[]) => void; filterKind?: 'image' | 'video' }`
- Uses shadcn `Dialog`
- Internal state: `currentFolderId`, `selectedFileIds: Set<number>`
- Header: title + close button
- Breadcrumb + search input
- Content: folder rows (clickable to navigate deeper) + file grid (multi-select with checkmarks)
- When `filterKind` is set, only show image/video files (not documents) — used when linking to posts
- Footer: "X arquivo(s) selecionado(s)" + "Vincular" button
- Search filters files by name within the current folder
- Reuses `getFolderContents` from fileService
- Files show thumbnail previews (images/videos) or file icon (documents)

- [ ] **Step 2: Run typecheck**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FilePickerModal.tsx
git commit -m "feat: add FilePickerModal for selecting existing files"
```

---

## Task 17: Integrate file picker into PostMediaGallery

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

- [ ] **Step 1: Add "Escolher arquivo" button and file picker**

In `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`:
- Import `FilePickerModal` from `../../arquivos/components/FilePickerModal`
- Import `linkFileToPost`, `unlinkFileFromPost` from `../../../services/fileService`
- Add state: `showFilePicker: boolean`
- Add a "Escolher arquivo" button next to the existing upload area
- When files are selected in the picker, call `linkFileToPost(fileId, postId)` for each
- Invalidate the `['post-media', postId]` query on success
- Update the delete handler: if the media item has `reference_count > 1` (or is from another folder), show an option to "Desvincular" (unlink) vs "Deletar" (delete)
- The unlink action calls `unlinkFileFromPost(linkId)` — the `id` from the legacy `PostMedia` shape is the `post_file_links.id`

- [ ] **Step 2: Add link indicator to media thumbnails**

Show a small link icon (`Link` from lucide-react) on media items where the underlying file's `reference_count > 1`, indicating it's shared across posts.

- [ ] **Step 3: Run typecheck and tests**

```bash
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx
git commit -m "feat: integrate file picker and unlink flow into PostMediaGallery"
```

---

## Task 18: Add Arquivos section to client detail page

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

- [ ] **Step 1: Add the Arquivos section**

In `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`:
- Import `getFolderContents` from `../../services/fileService`
- Import `FileGrid` from `../arquivos/components/FileGrid`
- Add a query to find the client's system folder: use `supabase.from('folders').select('id').eq('source_type', 'client').eq('source_id', clienteId).single()`
- Add an "Arquivos" section (after the Hub section, around line 854) that shows:
  - A compact FileGrid (grid mode) scoped to the client's folder
  - A "Ver todos os arquivos" link that navigates to `/arquivos` with the client folder selected (via URL param or state)
- Limit to showing the first 12 files; show a "Ver mais" link for the rest

- [ ] **Step 2: Run typecheck**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat: add Arquivos section to client detail page"
```

---

## Task 19: Final typecheck, test run, and verification

- [ ] **Step 1: Run full typecheck**

```bash
npm run build
```

Expected: No type errors, both CRM and Hub apps build successfully.

- [ ] **Step 2: Run test suite**

```bash
npm run test
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 3: Run edge function tests**

```bash
deno test supabase/functions/
```

Expected: All existing Deno tests pass.

- [ ] **Step 4: Start dev server and verify**

```bash
npm run dev
```

Verify in the browser:
1. Sidebar shows "Arquivos" item in the Gestão group
2. Navigate to `/arquivos` — see folder tree (empty without migration) and file grid
3. Navigate to `/entregas` — see the new "Escolher arquivo" button in PostMediaGallery
4. Navigate to a client detail page — see the Arquivos section

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address typecheck and test issues from file system implementation"
```
