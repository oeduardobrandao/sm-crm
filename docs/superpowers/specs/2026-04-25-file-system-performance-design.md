# File System Performance Optimization — Design Spec

## Context

The Arquivos (file system) feature was just implemented on `ebs/app-file-system-implementation`. The architecture is sound (presigned R2 uploads, atomic quota RPCs, lazy tree expansion), but there are measurable performance bottlenecks in both the edge function layer and the frontend data layer that add unnecessary latency and hurt perceived speed.

Current scale is light (< 50 files per folder), so the priority is **snappy navigation feel** and **future-proofing for scale** via perceived speed techniques (optimistic updates, prefetching, skeleton states).

Users navigate linearly: root → Clientes → specific client → workflow subfolder.

## Approach

Incremental optimization — fix specific bottlenecks without rearchitecting. Each optimization is independent and shippable on its own. Backend changes ship first since some frontend changes depend on new endpoints.

---

## Section 1: Backend Optimizations

### 1A. Batch folder sizes — replace N+1 RPCs

**Problem:** `file-manage/handler.ts` fires one `folder_total_size` RPC per subfolder via `Promise.all(folderIds.map(...))`. A folder with 20 subfolders = 20 DB round-trips.

**Solution:** New RPC `folder_sizes_batch(p_folder_ids uuid[])` that computes recursive sizes for all requested folders in a single call. The edge function calls this once with all subfolder IDs instead of N individual RPCs.

```sql
-- Returns one row per folder_id with its recursive total size
CREATE FUNCTION folder_sizes_batch(p_folder_ids uuid[])
RETURNS TABLE(folder_id uuid, total_size bigint)
```

**Files changed:**
- `supabase/migrations/` — new migration with the RPC
- `supabase/functions/file-manage/handler.ts` — replace `Promise.all(folderIds.map(id => svc.rpc("folder_total_size", ...)))` with single `svc.rpc("folder_sizes_batch", { p_folder_ids: folderIds })`

### 1B. Recursive CTE for breadcrumbs

**Problem:** The `while (currentId)` loop in `handler.ts` does one SELECT per folder level to build breadcrumbs. A folder 5 levels deep = 5 sequential queries.

**Solution:** New RPC `folder_breadcrumbs(p_folder_id uuid)` using a recursive CTE:

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, name, 0 as depth FROM folders WHERE id = p_folder_id
  UNION ALL
  SELECT f.id, f.parent_id, f.name, a.depth + 1
  FROM folders f JOIN ancestors a ON f.id = a.parent_id
)
SELECT id, name FROM ancestors ORDER BY depth DESC
```

One query regardless of folder depth.

**Files changed:**
- `supabase/migrations/` — new migration with the RPC
- `supabase/functions/file-manage/handler.ts` — replace `while` breadcrumb loop with single RPC call

### 1C. Subfolders-only tree endpoint

**Problem:** `FolderTree` calls `getFolderContents(folder.id)` to expand a node, which fetches subfolders AND files AND signs URLs for every file — but the tree only displays folder names and expand arrows.

**Solution:** New route `GET /tree?parent_id=X` on the `file-manage` edge function that returns only subfolder records:

```sql
SELECT f.id, f.name, f.source, f.source_type, f.position,
  EXISTS(SELECT 1 FROM folders c WHERE c.parent_id = f.id) as has_children
FROM folders f WHERE f.parent_id = $1 AND f.conta_id = $2
ORDER BY f.position, f.name
```

No files, no URL signing, no size computation.

**Files changed:**
- `supabase/functions/file-manage/handler.ts` — add `/tree` route handler
- `apps/crm/src/services/fileService.ts` — add `getTreeChildren(parentId)` function
- `apps/crm/src/pages/arquivos/components/FolderTree.tsx` — use new function instead of `getFolderContents`

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
- `['folder-tree', id]` — subfolder list only. Used by `FolderTree`, hitting the new lightweight endpoint.

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FolderTree.tsx` — change query key to `['folder-tree', id]`, use `getTreeChildren`
- `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx` — change query key to `['folder-contents', id]`

### 2B. Prefetch child folders on hover

When a user hovers over a folder card in the grid, prefetch its contents after a 150ms delay (debounced to avoid prefetching on casual mouse movement).

```ts
const prefetchTimeout = useRef<number>()

onMouseEnter={() => {
  prefetchTimeout.current = setTimeout(() => {
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
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — add hover prefetch to folder cards

### 2C. Seed tree cache from folder contents response

When `getFolderContents(id)` returns, its `subfolders` array already contains what the tree needs. Inject it into the tree cache:

```ts
onSuccess: (data) => {
  queryClient.setQueryData(
    ['folder-tree', currentFolderId],
    data.subfolders.map(f => ({ id: f.id, name: f.name, source: f.source, has_children: f.has_children }))
  )
}
```

Expanding a tree node for a folder already visited in the grid requires zero network calls.

**Files changed:**
- `apps/crm/src/pages/arquivos/ArquivosPage.tsx` — add `onSuccess` callback to folder contents query (or use a `useEffect` watching the query data)

### 2D. Targeted cache invalidation

Replace blanket `invalidateQueries({ queryKey: ['folder-contents'] })` with targeted invalidation:

| Mutation | Invalidate |
|---|---|
| Upload file | `['folder-contents', currentFolderId]`, `['folder-tree', currentFolderId]` |
| Create folder | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |
| Delete file/folder | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |
| Rename | `['folder-contents', parentFolderId]`, `['folder-tree', parentFolderId]` |

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — targeted invalidation
- `apps/crm/src/pages/arquivos/components/CreateFolderModal.tsx` — targeted invalidation
- `apps/crm/src/pages/arquivos/components/FileContextMenu.tsx` — targeted invalidation per action

---

## Section 3: Frontend UX — Perceived Speed

### 3A. Optimistic folder creation

In the create-folder mutation's `onMutate`, immediately insert the new folder into cached data:

```ts
onMutate: async (newFolder) => {
  await queryClient.cancelQueries({ queryKey: ['folder-contents', parentId] })
  const previous = queryClient.getQueryData(['folder-contents', parentId])
  queryClient.setQueryData(['folder-contents', parentId], old => ({
    ...old,
    subfolders: [...old.subfolders, { id: `temp-${Date.now()}`, name: newFolder.name, source: 'user', _optimistic: true }]
  }))
  return { previous }
},
onError: (err, vars, context) => {
  queryClient.setQueryData(['folder-contents', parentId], context.previous)
},
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: ['folder-contents', parentId] })
}
```

Optimistic entries render with a subtle shimmer/reduced opacity in `FileGrid`.

**Files changed:**
- `apps/crm/src/pages/arquivos/components/CreateFolderModal.tsx` — add optimistic mutation callbacks
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — render optimistic entries with visual indicator

### 3B. Optimistic file placement during upload

Insert a placeholder file entry into the grid cache as soon as upload starts:

- Generate a local preview URL via `URL.createObjectURL(file)`
- Insert into cached data with `_uploading: true` and `progress: 0`
- `FileGrid` renders these with a progress bar overlay on the card
- On finalize success, replace the optimistic entry with the real server record
- On error, remove the optimistic entry and show a toast

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — insert optimistic entries, update progress in cache
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — render uploading files with progress overlay

### 3C. Non-blocking upload pipeline

Reorder upload steps to maximize parallelism:

**Video (current):** capture thumbnail → request URL → upload → finalize
**Video (optimized):** request URL ∥ capture thumbnail (at 400px max width) → upload file + thumbnail → finalize

**Image (current):** request URL → upload → probe dimensions → blur hash → finalize
**Image (optimized):** request URL ∥ probe dimensions → upload → finalize → PATCH blur hash (background, non-blocking)

Add a concurrency limit: max 3 simultaneous file uploads using a simple queue. Files beyond the limit wait in the queue and start as slots free up.

**Files changed:**
- `apps/crm/src/services/fileService.ts` — reorder `uploadFile` steps, cap thumbnail resolution, add upload queue with concurrency limit
- `apps/crm/src/pages/arquivos/components/FileUploader.tsx` — use upload queue instead of unbounded `for...of`

### 3D. Skeleton loading states

Replace the loading spinner with skeleton placeholders:

- 6-8 skeleton cards matching file card dimensions (pulsing gray rectangles)
- 2-3 skeleton breadcrumb segments
- Skeleton appears instantly on navigation, content fades in on load

**Files changed:**
- `apps/crm/src/pages/arquivos/components/FileGrid.tsx` — add skeleton state when `isLoading`
- `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx` — add skeleton state

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

## Non-Goals

- **Pagination / virtualization** — not needed at current scale (< 50 files/folder)
- **Server-side caching (Redis/KV)** — Postgres handles the load fine
- **Materialized folder size columns** — batch query is fast enough
- **Search functionality** — separate feature, not a perf optimization
- **Background workers for blur hash** — still client-side, just non-blocking

## Implementation Order

1. **Backend (1A, 1B, 1C)** — new RPCs + tree endpoint. Ship first since frontend depends on them.
2. **Data layer (2A, 2B, 2C, 2D)** — cache unification, prefetch, seeding, targeted invalidation.
3. **UX (3A, 3B, 3C, 3D, 3E)** — optimistic updates, upload pipeline, skeletons. Each is independent.
