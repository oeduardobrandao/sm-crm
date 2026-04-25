# File System Performance Optimization — Design Spec

## Context

The Arquivos (file system) feature was just implemented on `ebs/app-file-system-implementation`. The architecture is sound (presigned R2 uploads, atomic quota RPCs, lazy tree expansion), but there are measurable performance bottlenecks in both the edge function layer and the frontend data layer that add unnecessary latency and hurt perceived speed.

Current scale is light (< 50 files per folder), so the priority is **snappy navigation feel** and **future-proofing for scale** via perceived speed techniques (optimistic updates, prefetching, skeleton states).

Users navigate linearly: root → Clientes → specific client → workflow subfolder.

## Approach

Incremental optimization — fix specific bottlenecks without rearchitecting. Each optimization is independent and shippable on its own. Backend changes ship first since some frontend changes depend on new endpoints.

### Key schema facts

- `folders.id` is `bigserial` (numeric), NOT uuid. All RPC parameters and return types must use `bigint`, not `uuid`.
- `folders.parent_id` is nullable — root folders have `parent_id IS NULL`. Any query filtering by `parent_id` must handle the null case with `IS NULL`, not `= NULL`.
- The frontend `Folder` type uses `id: number`. Optimistic entries must use a negative numeric temp ID (e.g., `-Date.now()`), not a string.
- The current folder contents response includes `total_size_bytes` and `file_count` per subfolder — both must be preserved in any batch replacement.

---

## Section 1: Backend Optimizations

### 1A. Batch folder sizes — replace N+1 RPCs

**Problem:** `file-manage/handler.ts:88` fires one `folder_total_size` RPC per subfolder via `Promise.all(folderIds.map(...))`. A folder with 20 subfolders = 20 DB round-trips.

**Solution:** New RPC `folder_sizes_batch(p_folder_ids bigint[])` that computes recursive sizes for all requested folders in a single call. Returns both `total_size_bytes` and `file_count` per folder to match the current response contract.

```sql
CREATE FUNCTION folder_sizes_batch(p_folder_ids bigint[])
RETURNS TABLE(folder_id bigint, total_size_bytes bigint, file_count bigint)
```

The edge function replaces the N individual RPCs with a single call:

```ts
const { data: sizes } = await svc.rpc("folder_sizes_batch", { p_folder_ids: folderIds });
```

Then maps `sizes` into the same `folderSizes` record structure already used at `handler.ts:94`.

**Files changed:**
- `supabase/migrations/` — new migration with the RPC
- `supabase/functions/file-manage/handler.ts` — replace `Promise.all(folderIds.map(id => svc.rpc("folder_total_size", ...)))` with single `svc.rpc("folder_sizes_batch", { p_folder_ids: folderIds })`

### 1B. Recursive CTE for breadcrumbs

**Problem:** The `while (currentId)` loop at `handler.ts:111-118` does one SELECT per folder level to build breadcrumbs. A folder 5 levels deep = 5 sequential queries.

**Solution:** New RPC `folder_breadcrumbs(p_folder_id bigint)` using a recursive CTE:

```sql
CREATE FUNCTION folder_breadcrumbs(p_folder_id bigint)
RETURNS TABLE(id bigint, name text)
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT f.id, f.parent_id, f.name, 0 as depth
    FROM folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT f.id, f.parent_id, f.name, a.depth + 1
    FROM folders f JOIN ancestors a ON f.id = a.parent_id
  )
  SELECT ancestors.id, ancestors.name FROM ancestors ORDER BY depth DESC
$$ LANGUAGE sql STABLE;
```

One query regardless of folder depth. Returns rows in root-first order, matching the current `breadcrumbs.unshift()` behavior.

**Files changed:**
- `supabase/migrations/` — new migration with the RPC
- `supabase/functions/file-manage/handler.ts` — replace `while` breadcrumb loop with single RPC call

### 1C. Subfolders-only tree endpoint

**Problem:** `FolderTree` calls `getFolderContents(folder.id)` to expand a node, which fetches subfolders AND files AND signs URLs for every file — but the tree only displays folder names and expand arrows.

**Solution:** New route `GET /tree?parent_id=X` on the `file-manage` edge function. The route handler must handle root (no `parent_id` or empty string) by filtering `parent_id IS NULL`:

```ts
// In handler.ts, new "tree" resource block:
const parentParam = url.searchParams.get("parent_id");
const parentFilter = parentParam ? Number(parentParam) : null;

const q = svc.from("folders").select("id, name, source, source_type, position").eq("conta_id", contaId);
if (parentFilter) q.eq("parent_id", parentFilter);
else q.is("parent_id", null);
q.order("source", { ascending: true }).order("name", { ascending: true });

const { data: subfolders } = await q;

// Check which subfolders have children (batch, not N+1)
const ids = (subfolders ?? []).map((f: any) => f.id);
let childFlags: Record<number, boolean> = {};
if (ids.length > 0) {
  const { data: children } = await svc.from("folders")
    .select("parent_id")
    .in("parent_id", ids);
  const parentSet = new Set((children ?? []).map((c: any) => c.parent_id));
  for (const id of ids) childFlags[id] = parentSet.has(id);
}

return json((subfolders ?? []).map((f: any) => ({
  ...f,
  has_children: childFlags[f.id] ?? false,
})));
```

No files, no URL signing, no size computation.

**Files changed:**
- `supabase/functions/file-manage/handler.ts` — add `tree` resource block with null-safe parent filtering
- `apps/crm/src/services/fileService.ts` — add `getTreeChildren(parentId)` function
- `apps/crm/src/pages/arquivos/components/FolderTree.tsx` — use new function instead of `getFolderContents`

### 1D. Backend support for non-blocking upload pipeline

The optimized upload flow in Section 3C requires two backend changes:

**1D-i. Make video thumbnail optional in `file-upload-url`**

Currently `file-upload-url/handler.ts:67` requires `thumbnail` for video uploads. Change this to make it optional — if not provided at URL-request time, the thumbnail URLs won't be returned, and the client will upload the thumbnail separately after capturing it (via a second presigned URL request or a dedicated thumbnail-upload endpoint).

Alternative (simpler): keep the thumbnail required but accept it means the client must capture the thumbnail before requesting the URL. In this case, 3C's video optimization becomes: capture thumbnail (at 400px) ∥ probe dimensions → request URL (with thumbnail metadata) → upload file + thumbnail → finalize. This still saves time by capping thumbnail resolution.

**Recommended approach:** Keep thumbnail required, cap resolution client-side. This avoids API contract changes while still improving speed.

**1D-ii. Add `blur_data_url` to file PATCH endpoint**

Currently `file-manage/handler.ts:206-221` only handles `name` and `folder_id` in the PATCH body. Add `blur_data_url` as an accepted field so that the blur hash can be PATCHed after finalize completes:

```ts
if (typeof body.blur_data_url === "string") patch.blur_data_url = body.blur_data_url;
```

This allows the image upload pipeline to: finalize immediately (file appears in DB) → PATCH blur hash in the background (non-blocking).

**Files changed:**
- `supabase/functions/file-manage/handler.ts` — accept `blur_data_url` in file PATCH
- `apps/crm/src/services/fileService.ts` — add `patchFileBlurHash(fileId, blurDataUrl)` function

---

## Section 2: Frontend Data Layer

### 2A. Unify cache keys

**Problem:** Three consumers use separate cache keys for the same `getFolderContents` endpoint:
- `ArquivosPage` → `['folder-contents', id]`
- `FolderTree` → `['folders', id]`
- `FilePickerModal` → `['picker-folder-contents', id]`

Mutations only invalidate `['folder-contents']`, leaving tree and picker stale.

**Solution:** After adding the subfolders-only endpoint (1C), concerns separate cleanly:
- `['folder-contents', id]` — full folder contents (files + subfolders + breadcrumbs). Used by `ArquivosPage`, `MobileArquivosView`, and `FilePickerModal`.
- `['folder-tree', id]` — subfolder list only. Used by `FolderTree`, hitting the new lightweight `/tree` endpoint.

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FolderTree.tsx` — change query key to `['folder-tree', id]`, use `getTreeChildren`
- `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx` — change query key to `['folder-contents', id]`

### 2B. Prefetch child folders on hover

When a user hovers over a folder card in the grid, prefetch its contents after a 150ms delay (debounced to avoid prefetching on casual mouse movement).

```ts
const prefetchTimeout = useRef<number>()

onMouseEnter={() => {
  prefetchTimeout.current = window.setTimeout(() => {
    queryClient.prefetchQuery({
      queryKey: ['folder-contents', folder.id],
      queryFn: () => getFolderContents(folder.id),
      staleTime: 30_000,
    })
  }, 150)
}}
onMouseLeave={() => clearTimeout(prefetchTimeout.current)}
```

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — add hover prefetch to folder cards (needs `queryClient` via `useQueryClient`)

### 2C. Seed tree cache from folder contents response

When `getFolderContents(id)` returns, its `subfolders` array contains most of what the tree needs. However, the current `FolderContents` response does not include `has_children` per subfolder. Two options:

**Option A (recommended):** Add `has_children` to the folder contents response. In `handler.ts`, after fetching subfolders, run the same batch child-check from 1C and include `has_children` in `subfoldersWithSize`. Add `has_children?: boolean` to the `Folder` type.

**Option B:** Don't seed the tree cache — let the tree always use its own lightweight endpoint. Simpler, but means tree expansion always hits the network even for visited folders.

With option A, seeding works:

```ts
useEffect(() => {
  if (data?.subfolders) {
    queryClient.setQueryData(
      ['folder-tree', currentFolderId],
      data.subfolders.map(f => ({ id: f.id, name: f.name, source: f.source, source_type: f.source_type, position: f.position, has_children: f.has_children ?? false }))
    )
  }
}, [data, currentFolderId, queryClient])
```

**Files changed:**
- `supabase/functions/file-manage/handler.ts` — add `has_children` to folder contents response (batch check, same pattern as 1C)
- `apps/crm/src/pages/arquivos/types.ts` — add `has_children?: boolean` to `Folder`
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — add `useEffect` to seed tree cache

### 2D. Targeted cache invalidation

Replace blanket `invalidateQueries({ queryKey: ['folder-contents'] })` with targeted invalidation:

| Mutation | Invalidate |
|---|---|
| Upload file | `['folder-contents', currentFolderId]`, `['folder-tree', currentFolderId]` |
| Create folder | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |
| Delete file/folder | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |
| Rename | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |

**Special case — first child:** When creating the first subfolder inside a folder, the parent folder's `has_children` bit in its ancestor's tree cache becomes stale. To handle this: after create-folder, also invalidate `['folder-tree', grandparentFolderId]` (the parent of the folder that just gained its first child). This is a lightweight invalidation since the tree endpoint is fast. Same applies to delete-last-child.

In practice, the simplest correct approach: after any folder create/delete, invalidate `['folder-tree']` broadly (all tree entries). The tree endpoint is so lightweight that refetching tree nodes is cheap. Reserve targeted invalidation for `['folder-contents']` where the savings are significant.

**Files changed:**
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — targeted invalidation in `handleCreateFolder`
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — targeted invalidation in `onUploadComplete`
- `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx` — targeted invalidation per action

Note: `CreateFolderModal.tsx` is presentational only (calls `onConfirm` prop) — the actual mutation logic lives in `ArquivosPage.tsx:52`.

---

## Section 3: Frontend UX — Perceived Speed

### 3A. Optimistic folder creation

The create-folder mutation lives in `ArquivosPage.tsx:52` (`handleCreateFolder`). Convert this to a `useMutation` with optimistic update callbacks:

```ts
const createFolderMutation = useMutation({
  mutationFn: (name: string) => createFolder(name, createFolderParent ?? null),
  onMutate: async (name) => {
    const parentId = createFolderParent ?? null;
    await queryClient.cancelQueries({ queryKey: ['folder-contents', parentId] })
    const previous = queryClient.getQueryData<FolderContents>(['folder-contents', parentId])
    queryClient.setQueryData<FolderContents>(['folder-contents', parentId], old => {
      if (!old) return old;
      const tempFolder: Folder = {
        id: -Date.now(),  // negative numeric temp ID — won't collide with real bigserial IDs
        conta_id: '',
        parent_id: parentId,
        name,
        source: 'user',
        source_type: null,
        source_id: null,
        name_overridden: false,
        position: 9999,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_size_bytes: 0,
        file_count: 0,
        _optimistic: true,
      };
      return { ...old, subfolders: [...old.subfolders, tempFolder] };
    })
    return { previous, parentId }
  },
  onError: (_err, _vars, context) => {
    if (context) queryClient.setQueryData(['folder-contents', context.parentId], context.previous)
    toast.error('Erro ao criar pasta')
  },
  onSettled: (_data, _err, _vars, context) => {
    if (context) {
      queryClient.invalidateQueries({ queryKey: ['folder-contents', context.parentId] })
      queryClient.invalidateQueries({ queryKey: ['folder-tree'] })
    }
  },
  onSuccess: () => toast.success('Pasta criada'),
})
```

Add `_optimistic?: boolean` to the `Folder` type. `FileGrid` renders optimistic entries with a subtle shimmer/reduced opacity.

**Files changed:**
- `apps/crm/src/pages/arquivos/types.ts` — add `_optimistic?: boolean` to `Folder`
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — convert `handleCreateFolder` to `useMutation` with optimistic callbacks
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — render optimistic folder entries with visual indicator (e.g., `opacity-50 animate-pulse`)

### 3B. Optimistic file placement during upload

Insert a placeholder file entry into the grid cache as soon as upload starts:

- Generate a local preview URL via `URL.createObjectURL(file)`
- Insert into cached data with `_uploading: true` and `progress: 0`
- `FileGrid` renders these with a progress bar overlay on the card
- On finalize success, replace the optimistic entry with the real server record (revoke the object URL)
- On error, remove the optimistic entry and show a toast

Add `_uploading?: boolean` and `progress?: number` to `FileRecord` type.

**Files changed:**
- `apps/crm/src/pages/arquivos/types.ts` — add `_uploading?: boolean`, `progress?: number` to `FileRecord`
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — insert optimistic entries into `['folder-contents', folderId]` cache, update progress in cache during upload
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — render uploading files with progress overlay

### 3C. Non-blocking upload pipeline

Reorder upload steps to maximize parallelism:

**Video (current):** capture thumbnail (full res) → request URL → upload → finalize
**Video (optimized):** capture thumbnail (capped at 400px width) → request URL (with thumbnail metadata) → upload file + thumbnail → finalize

The video flow still captures thumbnail first (required by `file-upload-url`), but capping at 400px makes it much faster than full resolution.

**Image (current):** request URL → upload → probe dimensions → blur hash → finalize (blur hash included in finalize body)
**Image (optimized):** request URL ∥ probe dimensions → upload → finalize (without blur hash) → PATCH blur hash (background, non-blocking via 1D-ii)

The image flow parallelizes URL request and dimension probing, then finalizes immediately without waiting for blur hash. The blur hash is generated and PATCHed in the background — the file is already visible in the DB.

**Concurrency limit:** Max 3 simultaneous file uploads using a simple queue. Files beyond the limit wait and start as slots free up.

**Files changed:**
- `apps/crm/src/services/fileService.ts` — reorder `uploadFile` steps, cap video thumbnail canvas to 400px width, add `patchFileBlurHash` function, add upload queue with concurrency limit
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — use upload queue instead of unbounded `for...of`

### 3D. Skeleton loading states

Replace the loading spinner with skeleton placeholders:

- 6-8 skeleton cards matching file card dimensions (pulsing gray rectangles)
- 2-3 skeleton breadcrumb segments
- Skeleton appears instantly on navigation, content fades in on load

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — add skeleton state when `isLoading` (export a `FileGridSkeleton` or accept an `isLoading` prop)
- `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx` — add skeleton state
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — use skeleton components instead of `<Spinner />`

### 3E. Stale-while-revalidate + longer gcTime

Increase `gcTime` for folder contents so navigating back to a previously visited folder shows cached data instantly while revalidating in the background:

```ts
useQuery({
  queryKey: ['folder-contents', folderId],
  queryFn: () => getFolderContents(folderId),
  staleTime: 30_000,
  gcTime: 5 * 60 * 1000,
})
```

Combined with hover prefetching (2B), back-and-forth navigation feels like a local app.

**Files changed:**
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — set `gcTime`
- `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx` — set `gcTime`

---

## Section 4: File Opening / Preview

Currently `handleFileAction` in `ArquivosPage.tsx:63` has a stub for `action === 'open'`. Implement file opening using existing components.

### 4A. Image and video preview — reuse PostMediaLightbox

Open images and videos in the existing `PostMediaLightbox` component (`apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`). This already supports:
- Full-screen overlay with carousel navigation
- Image display and video playback with controls
- Keyboard navigation (arrows, Esc) and touch swipe
- Proper focus management via Radix Dialog

**Implementation:**

Add state to `ArquivosPage` to track the lightbox:

```ts
const [lightboxOpen, setLightboxOpen] = useState(false);
const [lightboxIndex, setLightboxIndex] = useState(0);

// Filter to only image/video files for the lightbox media array
const mediaFiles = files.filter(f => f.kind === 'image' || f.kind === 'video');
```

In `handleFileAction`:

```ts
function handleFileAction(action: string, file: FileRecord) {
  if (action === 'open') {
    if (file.kind === 'image' || file.kind === 'video') {
      const idx = mediaFiles.findIndex(f => f.id === file.id);
      if (idx >= 0) {
        setLightboxIndex(idx);
        setLightboxOpen(true);
      }
    } else {
      // Document — open in new tab
      openDocument(file);
    }
  }
}
```

The `PostMediaLightbox` expects a `media` array with `{ id, url, type }` shape. Map `FileRecord[]` to this format:

```ts
const lightboxMedia = mediaFiles.map(f => ({
  id: f.id,
  url: f.url ?? '',
  type: f.kind as 'image' | 'video',
  thumbnail_url: f.thumbnail_url,
}));
```

Render the lightbox in the JSX:

```tsx
<PostMediaLightbox
  media={lightboxMedia}
  initialIndex={lightboxIndex}
  open={lightboxOpen}
  onOpenChange={setLightboxOpen}
/>
```

### 4B. Document opening — new tab with browser-native display

For documents (PDFs and other file types), open in a new browser tab:

```ts
function openDocument(file: FileRecord) {
  if (!file.url) {
    // Documents don't get signed URLs by default (handler.ts:103 skips kind === 'document')
    // Need to fetch a signed URL first
    getFileDownloadUrl(file.id).then(url => window.open(url, '_blank'));
    return;
  }
  window.open(file.url, '_blank');
}
```

The browser will natively render PDFs and some other formats. If the browser can't display the format, it will trigger a download — which is the correct fallback behavior. No need to detect unsupported formats ourselves.

**Note:** Currently `handler.ts:103` only signs URLs for non-document files (`f.kind !== "document"`). Documents in the grid have `url: null`. We need a way to get a signed URL for a document on demand. Options:
- Add a dedicated `GET /files/:id/url` endpoint that returns a signed download URL
- Or change the folder listing to sign document URLs too (simpler but wastes signing for documents that are never opened)

**Recommended:** Add `GET /files/:id/url` endpoint. This keeps folder listings fast (no unnecessary document URL signing) and only signs when the user actually clicks to open.

### 4C. Same behavior for MobileArquivosView

Pass the same `handleFileAction` and lightbox state down to `MobileArquivosView` so mobile users get the same preview experience.

**Files changed:**
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — add lightbox state, implement `handleFileAction`, render `PostMediaLightbox`
- `apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx` — receive and use `handleFileAction` (already has `onFileAction` prop)
- `supabase/functions/file-manage/handler.ts` — add `GET /files/:id/url` endpoint for on-demand document URL signing
- `apps/crm/src/services/fileService.ts` — add `getFileDownloadUrl(fileId)` function

---

## Non-Goals

- **Pagination / virtualization** — not needed at current scale (< 50 files/folder)
- **Server-side caching (Redis/KV)** — Postgres handles the load fine
- **Materialized folder size columns** — batch query is fast enough
- **Search functionality** — separate feature, not a perf optimization
- **Custom PDF viewer component** — browser-native PDF rendering is sufficient

## Implementation Order

1. **Backend (1A, 1B, 1C, 1D)** — new RPCs, tree endpoint, file PATCH extension, document URL endpoint. Ship first since frontend depends on them.
2. **Data layer (2A, 2B, 2C, 2D)** — cache unification, prefetch, seeding, targeted invalidation.
3. **UX (3A, 3B, 3C, 3D, 3E)** — optimistic updates, upload pipeline, skeletons. Each is independent.
4. **File opening (4A, 4B, 4C)** — preview integration. Independent of sections 1-3, can be done in parallel.
