# File System — Design Spec

A file-first media management system for the CRM, using Cloudflare R2 for storage. Files are the primary entity; workflow posts reference files through a junction table. Auto-generated folders mirror the client/workflow/post hierarchy and are protected by soft-lock warnings.

## Scope

- CRM app only — no Hub changes (Hub continues accessing media through `hub-posts` edge function)
- Any file type (images, videos, PDFs, PSDs, ZIPs, etc.) for standalone storage
- Only images and videos can be linked to workflow posts (matches existing CRM/Hub rendering capabilities)
- Workspace-level and client-level files supported
- Media files are linkable across multiple posts with reference counting

## Data Model

### folders

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial | PK |
| conta_id | uuid | FK → workspaces, NOT NULL |
| parent_id | bigint | FK → folders (nullable, NULL = root) |
| name | text | Display name |
| source | text | `'system'` or `'user'` |
| source_type | text | `'client'`, `'workflow'`, `'post'`, or NULL (user folders) |
| source_id | bigint | FK to source entity, nullable |
| name_overridden | boolean | DEFAULT false — set true when user renames a system folder |
| position | int | Sort order |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

**Constraints:**
- UNIQUE(conta_id, source_type, source_id) — prevents duplicate auto-folders
- INDEX(conta_id, parent_id) — tree traversal

**Hierarchy:**
```
[root: parent_id=NULL]
├── Client A folder       (source=system, source_type=client, source_id=42)
│   ├── Workflow X folder  (source=system, source_type=workflow, source_id=101)
│   │   ├── Post 1 folder  (source=system, source_type=post, source_id=501)
│   │   └── Post 2 folder  (source=system, source_type=post, source_id=502)
│   └── Brand Assets       (source=user, parent_id=client_folder_id)
├── Client B folder       (source=system, source_type=client, source_id=43)
└── Templates             (source=user, parent_id=NULL — workspace-level)
```

### files

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial | PK |
| conta_id | uuid | FK → workspaces, NOT NULL |
| folder_id | bigint | FK → folders ON DELETE SET NULL (nullable, NULL = root) |
| r2_key | text | NOT NULL |
| thumbnail_r2_key | text | nullable |
| name | text | Display name (original filename) |
| kind | text | `'image'`, `'video'`, `'document'` |
| mime_type | text | |
| size_bytes | bigint | > 0 |
| width | int | nullable (images/videos) |
| height | int | nullable (images/videos) |
| duration_seconds | int | nullable (videos) |
| blur_data_url | text | nullable (base64 webp placeholder) |
| uploaded_by | uuid | FK → auth.users |
| reference_count | int | DEFAULT 0, maintained by triggers |
| created_at | timestamptz | DEFAULT now() |

**Constraints:**
- INDEX(conta_id, folder_id) — folder contents query
- INDEX(r2_key) — R2 key lookup
- Videos require thumbnail: kind='video' → thumbnail_r2_key NOT NULL

**R2 key patterns:**
- Existing (migrated from post_media): `contas/{conta_id}/posts/{post_id}/{media_id}.{ext}`
- New standalone uploads: `contas/{conta_id}/files/{file_id}.{ext}`

### post_file_links

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial | PK |
| post_id | bigint | FK → workflow_posts ON DELETE CASCADE |
| file_id | bigint | FK → files ON DELETE RESTRICT |
| conta_id | uuid | FK → workspaces, NOT NULL (denormalized for RLS) |
| is_cover | boolean | DEFAULT false |
| sort_order | int | DEFAULT 0 |
| created_at | timestamptz | DEFAULT now() |

**Constraints:**
- UNIQUE(post_id, file_id) — no duplicate links
- Partial unique index: one cover per post (WHERE is_cover = true)
- Only image/video files can be linked: CHECK enforced at edge function level (file.kind IN ('image', 'video'))

**Cover behavior (triggers):**
- **Auto-cover on first link:** When the first `post_file_link` is inserted for a post and no cover exists, `is_cover` is set to true automatically.
- **Cover reassignment on unlink/delete:** When a link with `is_cover = true` is deleted, the trigger promotes the next link (lowest sort_order, then lowest id) to cover. If no links remain, the post has no cover.
- These match the existing `post_media` cover rules from the current system.

**Adapter ID mapping:**
- The `post-media-manage` adapter operates on `post_file_links.id` as the "media ID" for backward compatibility. CRM callers that PATCH/DELETE by media ID are actually targeting the link record. The adapter translates: `link.id` maps to the old `post_media.id`, and the response shape merges file metadata (from `files`) with link metadata (is_cover, sort_order) into the legacy `PostMedia`-shaped record.

### file_deletions

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial | PK |
| r2_key | text | NOT NULL |
| thumbnail_r2_key | text | nullable |
| queued_at | timestamptz | DEFAULT now() |
| attempts | int | DEFAULT 0 |
| last_error | text | nullable |
| next_retry_at | timestamptz | DEFAULT now() |

Matches the existing `post_media_deletions` pattern including retry/error tracking. The cleanup cron increments `attempts` on failure, stores the error in `last_error`, and sets `next_retry_at` with exponential backoff. Rows with `attempts >= 5` are logged and skipped (dead-lettered).

## Auto-Folder Sync (Postgres Triggers)

### ON INSERT

- **clientes INSERT** → Create folder with source=system, source_type=client, source_id=NEW.id, parent_id=NULL, name=NEW.nome
- **workflows INSERT** → Look up client folder by (source_type=client, source_id=NEW.cliente_id). Create folder with source=system, source_type=workflow, source_id=NEW.id, parent_id=client_folder.id, name=NEW.titulo
- **workflow_posts INSERT** → Look up workflow folder by (source_type=workflow, source_id=NEW.workflow_id). Create folder with source=system, source_type=post, source_id=NEW.id, parent_id=workflow_folder.id, name=NEW.titulo

### ON UPDATE

- **Name changes:** When a client/workflow/post name changes, update the matching folder's name — but only if `name_overridden = false`.
- **Workflow client reassignment:** When `workflows.cliente_id` changes, look up the new client's folder and update the workflow folder's `parent_id` to point to it. This keeps the folder hierarchy consistent when workflows are moved between clients via the UI.

### ON DELETE (entity-side triggers)

When a source entity is deleted, the corresponding system folder is deleted by entity-side triggers:

- **clientes DELETE** → DELETE FROM folders WHERE source_type='client' AND source_id=OLD.id AND conta_id=OLD.conta_id
- **workflows DELETE** → DELETE FROM folders WHERE source_type='workflow' AND source_id=OLD.id AND conta_id=OLD.conta_id
- **workflow_posts DELETE** → DELETE FROM folders WHERE source_type='post' AND source_id=OLD.id AND conta_id=OLD.conta_id

### ON DELETE (folder-side FK behavior)

- Folder `parent_id` uses ON DELETE CASCADE — deleting a parent folder cascades to child folders.
- Files use ON DELETE SET NULL on `folder_id` — when a folder is deleted, files inside it are orphaned to root (folder_id=NULL) rather than deleted. This prevents conflicts with reference counting.
- File deletion trigger (on actual file DELETE) queues r2_key and thumbnail_r2_key to `file_deletions`.
- `post_file_links` ON DELETE CASCADE on `post_id` cleans up links when a post is deleted.
- `post_file_links` `file_id` FK uses RESTRICT — cannot delete a file row while links exist (enforced at DB level, UI blocks this via reference_count check before attempting).

## Soft-Lock Protection Model

System folders (source='system') show an "AUTO" badge in the UI.

**Always allowed:**
- Browse, view, download any folder or file
- Create user folders inside system folders
- Upload files into any folder
- Full CRUD on user-created folders and files

**Warning before proceeding:**
- **Rename system folder** → "This folder is linked to [entity type]. Renaming here won't rename the [entity]." Sets `name_overridden = true`.
- **Move system folder** → "Moving this folder changes its location in the file browser only, not in the workflow."

**Blocked:**
- **Delete system folder** → Blocked entirely. System folders are owned by the sync lifecycle and cannot be deleted by users. They are removed only when the source entity (client/workflow/post) is deleted. This preserves the guarantee that auto-folders mirror the hierarchy, and prevents the upload flow from losing its target folder.

**Blocked (with explanation):**
- **Delete file with reference_count > 0** → Shows dialog listing which posts use the file. User must unlink from posts first.

## Upload Flow

### Standalone Upload (File Browser)

1. User navigates to a folder in `/arquivos` and clicks Upload or drags files
2. Client calls `file-upload-url` edge function: `{ folder_id, filename, mime_type, size }`
3. Edge function validates folder ownership (conta_id), does advisory quota pre-check, generates file_id, returns `{ file_id, upload_url, r2_key, thumbnail_upload_url?, thumbnail_r2_key? }`
4. Client uploads to R2 via presigned PUT (with progress tracking)
5. Client calls `file-upload-finalize`: `{ file_id, size_bytes, width?, height?, blur_data_url? }`
6. Edge function verifies R2 object, enforces atomic quota, inserts `files` row
7. File appears in browser with reference_count=0

### Workflow Upload (Entregas)

Two paths from PostMediaGallery:

**Path A — "Upload novo" (new file):**
Same as standalone flow, but `folder_id` is the post's auto-folder and `post_id` is provided. The finalize step also creates a `post_file_link`. Result: reference_count=1.

**Path B — "Escolher arquivo" (pick existing):**
Opens file picker modal. User selects file(s). Client calls `file-manage` to create `post_file_link(s)`. Triggers increment reference_count.

## Edge Functions

### New

| Function | Purpose |
|----------|---------|
| `file-upload-url` | Generate presigned R2 upload URL for any file type. Validates folder ownership. Advisory quota check. |
| `file-upload-finalize` | Verify R2 object, atomic quota enforcement, insert `files` row. Optionally create `post_file_link` if `post_id` provided. |
| `file-manage` | CRUD for files and folders. GET folder contents. PATCH rename/move. DELETE with reference count check. POST create folder. POST link/unlink file to post. |

### Modified

| Function | Change |
|----------|--------|
| `post-media-manage` | Adapter — delegates to `file-manage` internally. Kept for backward compatibility during migration. Deprecated after full migration. |
| `hub-posts` | Updated to join through `post_file_links → files` instead of `post_media`. Response shape unchanged — Hub clients see no difference. |
| `post-media-cleanup-cron` → `file-cleanup-cron` | Renamed. Drains `file_deletions` instead of `post_media_deletions`. Same logic. |

## Migration Strategy

Single SQL migration, executed in order:

1. **Create tables** — `folders`, `files`, `post_file_links`, `file_deletions`
2. **Backfill folders** — INSERT from `clientes` (source_type=client), `workflows` (source_type=workflow, parent=client folder), `workflow_posts` (source_type=post, parent=workflow folder)
3. **Migrate post_media → files** — INSERT into `files` from `post_media`, preserving R2 keys. `folder_id` = matching post folder. No R2 re-upload.
4. **Create post_file_links** — INSERT from the post_media → files mapping (post_id, file_id, is_cover, sort_order)
5. **Set reference counts** — UPDATE files SET reference_count = (count from post_file_links)
6. **Install triggers** — Auto-folder sync, reference count, quota, deletion queue
7. **Drop post_media** — Deferred to a separate, later migration after all code is updated

## UI Components

### Arquivos Page (`/arquivos`)

New top-level route added to the sidebar.

**Layout:**
- Left panel (260px): Collapsible folder tree. System folders show "AUTO" badge. "+ Nova pasta" button at bottom.
- Right panel: Breadcrumb navigation at top. Upload button + grid/list view toggle. Subfolder cards section. Files grid with thumbnails, name, size, type, reference count badge.

**Features:**
- Drag-and-drop upload
- Grid view (thumbnail cards) and list view (table rows)
- Right-click context menu: Rename, Move, Delete, Download, Copy link
- Search within current folder
- Breadcrumb navigation with clickable path segments

### File Picker Modal

Opened from PostMediaGallery via "Escolher arquivo" button.

**Layout:**
- Header: Title + close button
- Breadcrumb + search bar
- Content: Folder rows (clickable to navigate) + file grid (multi-select with checkmarks)
- Footer: Selection count + "Vincular" (Link) button

### Integration Points

**Entregas (PostMediaGallery):**
- Existing upload button stays — creates file in post's auto-folder + auto-links
- New "Escolher arquivo" button opens file picker modal
- Media thumbnails show link icon if reference_count > 1
- "Remover" action asks: unlink from this post, or delete file entirely (if reference_count would become 0)

**Client Detail (`/clientes/:id`):**
- New "Arquivos" tab showing compact file browser scoped to client folder
- Quick link to open full Arquivos page filtered to that client

## RLS Policies

- `folders`: `conta_id IN (SELECT get_my_conta_id())` — SELECT, INSERT, UPDATE, DELETE restricted to workspace members
- `files`: `conta_id IN (SELECT get_my_conta_id())` — SELECT, INSERT, UPDATE, DELETE restricted to workspace members
- `post_file_links`: `conta_id IN (SELECT get_my_conta_id())` — denormalized `conta_id` column enables the same direct RLS pattern. SELECT, INSERT, DELETE restricted to workspace members.
- `file_deletions`: RLS disabled. Only written by triggers (SECURITY DEFINER functions) and read by the cleanup cron (service-role). No direct user access.

## Quota

Reuses the existing workspace quota system (`workspaces.storage_quota_bytes` and `storage_used_bytes`). The atomic quota RPC is adapted for the `files` table:

- `file_insert_with_quota()` — locks workspace row, checks quota, inserts file, updates `storage_used_bytes`
- Trigger on files DELETE decrements `storage_used_bytes`

## Out of Scope

- Hub file access (Hub continues through `hub-posts` as-is)
- File versioning
- File sharing / public links
- Full-text search across file contents
- Folder permissions (all workspace members see all files)
- Drag-and-drop reordering of folders
