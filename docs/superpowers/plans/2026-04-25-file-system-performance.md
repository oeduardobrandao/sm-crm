# File System Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Arquivos file system for snappy navigation, instant perceived uploads, and future-proof caching.

**Architecture:** Backend N+1 queries replaced with batch RPCs and a lightweight tree endpoint. Frontend unified on two cache keys with hover prefetching, optimistic mutations, and skeleton states. File preview reuses the existing `PostMediaLightbox` component.

**Tech Stack:** Supabase Postgres RPCs (PL/pgSQL), Deno edge functions, React + TanStack Query, Radix Dialog.

**Spec:** `docs/superpowers/specs/2026-04-25-file-system-performance-design.md`

---

### Task 1: Batch folder sizes RPC (migration)

**Files:**
- Create: `supabase/migrations/20260425100001_folder_sizes_batch.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260425100001_folder_sizes_batch.sql
CREATE OR REPLACE FUNCTION folder_sizes_batch(p_folder_ids bigint[])
RETURNS TABLE(folder_id bigint, total_size_bytes bigint, file_count bigint) AS $$
  SELECT sub.folder_id, sub.total_size_bytes, sub.file_count
  FROM unnest(p_folder_ids) AS input(folder_id)
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(SUM(fi.size_bytes), 0)::bigint AS total_size_bytes,
      COUNT(fi.id)::bigint AS file_count
    FROM (
      WITH RECURSIVE tree AS (
        SELECT id FROM folders WHERE id = input.folder_id
        UNION ALL
        SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
      )
      SELECT id FROM tree
    ) t
    LEFT JOIN files fi ON fi.folder_id = t.id
  ) sub;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

- [ ] **Step 2: Verify migration applies locally**

Run: `npx supabase db reset` or review with `npx supabase db diff`
Expected: No errors, function `folder_sizes_batch` exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260425100001_folder_sizes_batch.sql
git commit -m "feat: add folder_sizes_batch RPC for batch folder size computation"
```

---

### Task 2: Breadcrumbs RPC (migration)

**Files:**
- Create: `supabase/migrations/20260425100002_folder_breadcrumbs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260425100002_folder_breadcrumbs.sql
CREATE OR REPLACE FUNCTION folder_breadcrumbs(p_folder_id bigint)
RETURNS TABLE(id bigint, name text) AS $$
  WITH RECURSIVE ancestors AS (
    SELECT f.id, f.parent_id, f.name, 0 AS depth
    FROM folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT f.id, f.parent_id, f.name, a.depth + 1
    FROM folders f JOIN ancestors a ON f.id = a.parent_id
  )
  SELECT ancestors.id, ancestors.name FROM ancestors ORDER BY depth DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260425100002_folder_breadcrumbs.sql
git commit -m "feat: add folder_breadcrumbs RPC using recursive CTE"
```

---

### Task 3: Write tests for backend changes (tree endpoint, batch sizes, breadcrumbs, file PATCH blur_data_url, file URL endpoint)

**Files:**
- Modify: `supabase/functions/__tests__/file-manage_test.ts`

- [ ] **Step 1: Add tests for the tree endpoint**

Append to `supabase/functions/__tests__/file-manage_test.ts`:

```ts
// ─── TREE: GET ──────────────────────────────────────────────

Deno.test("file-manage: GET /tree returns subfolders with has_children", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // subfolders query
  db.queue("folders", "select", {
    data: [
      { id: 1, name: "Marketing", source: "system", source_type: "client", position: 0 },
      { id: 2, name: "My Folder", source: "user", source_type: null, position: 1 },
    ],
    error: null,
  });
  // child existence check
  db.queue("folders", "select", {
    data: [{ parent_id: 1 }],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/tree"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.length, 2);
  assertEquals(body[0].has_children, true);
  assertEquals(body[1].has_children, false);
  // Should NOT contain files or breadcrumbs
  assertEquals(body[0].url, undefined);
});

Deno.test("file-manage: GET /tree?parent_id=1 returns children of folder 1", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", {
    data: [{ id: 3, name: "Sub", source: "user", source_type: null, position: 0 }],
    error: null,
  });
  db.queue("folders", "select", { data: [], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/tree?parent_id=1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Sub");
  assertEquals(body[0].has_children, false);
});
```

- [ ] **Step 2: Add tests for batch folder sizes (replacing N+1)**

```ts
// ─── FOLDERS: GET with batch sizes ───────────────────────────

Deno.test("file-manage: GET /folders uses folder_sizes_batch for multiple subfolders", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", {
    data: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    error: null,
  });
  db.queue("files", "select", { data: [], error: null });
  // folder_sizes_batch RPC returns both folders' sizes
  db.queueRpc("folder_sizes_batch", {
    data: [
      { folder_id: 1, total_size_bytes: 500, file_count: 3 },
      { folder_id: 2, total_size_bytes: 1200, file_count: 7 },
    ],
    error: null,
  });
  // has_children check
  db.queue("folders", "select", { data: [{ parent_id: 1 }], error: null });
  // workspace
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.subfolders[0].total_size_bytes, 500);
  assertEquals(body.subfolders[0].file_count, 3);
  assertEquals(body.subfolders[1].total_size_bytes, 1200);
  assertEquals(body.subfolders[1].file_count, 7);
  assertEquals(body.subfolders[0].has_children, true);
  assertEquals(body.subfolders[1].has_children, false);
});
```

- [ ] **Step 3: Add tests for breadcrumb RPC**

```ts
Deno.test("file-manage: GET /folders?parent_id uses folder_breadcrumbs RPC", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  // folder_breadcrumbs RPC
  db.queueRpc("folder_breadcrumbs", {
    data: [{ id: 1, name: "Root" }, { id: 5, name: "Sub" }],
    error: null,
  });
  // folder detail
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  // workspace
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.breadcrumbs.length, 2);
  assertEquals(body.breadcrumbs[0].name, "Root");
  assertEquals(body.breadcrumbs[1].name, "Sub");
});
```

- [ ] **Step 4: Add test for file PATCH with blur_data_url**

```ts
Deno.test("file-manage: PATCH /files/:id accepts blur_data_url", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("files", "update", { data: { id: 10, blur_data_url: "data:image/webp;base64,abc" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { blur_data_url: "data:image/webp;base64,abc" }));
  assertEquals(res.status, 200);
});
```

- [ ] **Step 5: Add test for GET /files/:id/url endpoint**

```ts
// ─── FILES: GET URL ──────────────────────────────────────────

Deno.test("file-manage: GET /files/:id/url returns signed URL", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", {
    data: { id: 20, conta_id: "conta-1", r2_key: "contas/conta-1/files/report.pdf" },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/20/url"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.url, "https://signed.example.com/contas/conta-1/files/report.pdf");
});

Deno.test("file-manage: GET /files/:id/url not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/999/url"));
  assertEquals(res.status, 404);
});

Deno.test("file-manage: GET /files/:id/url wrong workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { id: 20, conta_id: "other-ws", r2_key: "x" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/20/url"));
  assertEquals(res.status, 404);
});
```

- [ ] **Step 6: Run all tests to verify they FAIL (implementation not done yet)**

Run: `deno test supabase/functions/__tests__/file-manage_test.ts`
Expected: New tests fail (tree endpoint, batch sizes, breadcrumbs RPC, blur_data_url PATCH, file URL endpoint don't exist yet). Existing tests should still pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/__tests__/file-manage_test.ts
git commit -m "test: add tests for tree endpoint, batch sizes, breadcrumbs, blur PATCH, file URL"
```

---

### Task 4: Implement backend — tree endpoint, batch sizes, breadcrumbs, blur PATCH, file URL

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`

- [ ] **Step 1: Add tree endpoint**

In `handler.ts`, add a new resource block BEFORE the `folders` block (at the top of the resource routing, after `const contaId = profile.conta_id;` at line 39):

```ts
    // ─── TREE (lightweight folder listing for sidebar) ────────
    if (resource === "tree") {
      if (req.method === "GET") {
        const parentParam = url.searchParams.get("parent_id");
        const parentFilter = parentParam ? Number(parentParam) : null;

        const q = svc.from("folders")
          .select("id, name, source, source_type, position")
          .eq("conta_id", contaId);
        if (parentFilter) q.eq("parent_id", parentFilter);
        else q.is("parent_id", null);
        q.order("source", { ascending: true }).order("name", { ascending: true });

        const { data: subfolders } = await q;
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
      }
    }
```

- [ ] **Step 2: Replace N+1 folder_total_size with folder_sizes_batch**

In the `GET /folders` handler (list folder contents, currently at line 68), replace lines 84–95 (the `Promise.all(folderIds.map(...))` block) with:

```ts
        const folderIds = (subfolders ?? []).map((f: any) => f.id);
        let folderSizes: Record<number, { total_size_bytes: number; file_count: number }> = {};
        if (folderIds.length > 0) {
          const { data: sizeRows } = await svc.rpc("folder_sizes_batch", { p_folder_ids: folderIds });
          for (const r of (sizeRows ?? [])) {
            folderSizes[r.folder_id] = { total_size_bytes: r.total_size_bytes, file_count: r.file_count };
          }
        }
```

- [ ] **Step 3: Add has_children to folder contents response**

Right after the `folderSizes` block from Step 2, add a batch has_children check:

```ts
        let hasChildrenFlags: Record<number, boolean> = {};
        if (folderIds.length > 0) {
          const { data: children } = await svc.from("folders")
            .select("parent_id")
            .in("parent_id", folderIds);
          const parentSet = new Set((children ?? []).map((c: any) => c.parent_id));
          for (const id of folderIds) hasChildrenFlags[id] = parentSet.has(id);
        }
```

Then update the `subfoldersWithSize` mapping (currently at line 97) to include `has_children`:

```ts
        const subfoldersWithSize = (subfolders ?? []).map((f: any) => ({
          ...f,
          total_size_bytes: folderSizes[f.id]?.total_size_bytes ?? 0,
          file_count: folderSizes[f.id]?.file_count ?? 0,
          has_children: hasChildrenFlags[f.id] ?? false,
        }));
```

- [ ] **Step 4: Replace breadcrumb while-loop with RPC**

Replace the breadcrumb block (currently lines 109–118) with:

```ts
        let breadcrumbs: { id: number; name: string }[] = [];
        if (parentFilter) {
          const { data: crumbs } = await svc.rpc("folder_breadcrumbs", { p_folder_id: parentFilter });
          breadcrumbs = (crumbs ?? []).map((c: any) => ({ id: c.id, name: c.name }));
        }
```

- [ ] **Step 5: Add blur_data_url to file PATCH**

In the `FILES` PATCH handler (currently at line 213), add after the `folder_id` check:

```ts
        if (typeof body.blur_data_url === "string") patch.blur_data_url = body.blur_data_url;
```

- [ ] **Step 6: Add GET /files/:id/url endpoint**

In the `FILES` block, add a new handler before the PATCH handler:

```ts
      // GET /files/:id/url → signed download URL
      if (req.method === "GET" && idStr) {
        const subResource = parts[idx + 3];
        if (subResource === "url") {
          const fileId = Number(idStr);
          const { data: file } = await svc.from("files").select("conta_id, r2_key").eq("id", fileId).single();
          if (!file || file.conta_id !== contaId) return json({ error: "File not found" }, 404);
          const url = await deps.signUrl(file.r2_key);
          return json({ url });
        }
      }
```

Note: This handler checks for `parts[idx + 3] === "url"` to differentiate `GET /files/20/url` from other GET routes.

- [ ] **Step 7: Run tests**

Run: `deno test supabase/functions/__tests__/file-manage_test.ts`
Expected: All tests pass including the new ones. Some existing tests that relied on the old `folder_total_size` per-folder RPC will need their mock data updated to use `folder_sizes_batch` and `has_children` — update them to match the new call pattern.

- [ ] **Step 8: Fix any failing existing tests**

The existing test "GET /folders lists root folders and files" queues `folder_total_size` per subfolder. Update it to queue `folder_sizes_batch` instead and add the has_children mock:

```ts
Deno.test("file-manage: GET /folders lists root folders and files", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [{ id: 1, name: "Marketing" }], error: null });
  db.queue("files", "select", {
    data: [{ id: 10, name: "logo.png", kind: "image", r2_key: "contas/conta-1/files/logo.png", thumbnail_r2_key: null }],
    error: null,
  });
  // folder_sizes_batch replaces per-folder RPCs
  db.queueRpc("folder_sizes_batch", {
    data: [{ folder_id: 1, total_size_bytes: 1024, file_count: 2 }],
    error: null,
  });
  // has_children check
  db.queue("folders", "select", { data: [], error: null });
  // workspace storage query
  db.queue("workspaces", "select", { data: { storage_used_bytes: 5000, storage_quota_bytes: 1000000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.subfolders.length, 1);
  assertEquals(body.subfolders[0].total_size_bytes, 1024);
  assertEquals(body.subfolders[0].file_count, 2);
  assertEquals(body.subfolders[0].has_children, false);
  assertEquals(body.files.length, 1);
  assertEquals(body.files[0].url, "https://signed.example.com/contas/conta-1/files/logo.png");
  assertEquals(body.breadcrumbs, []);
  assertEquals(body.folder, null);
  assertEquals(body.storage.used_bytes, 5000);
});
```

Similarly update "GET /folders?parent_id builds breadcrumbs" to use the `folder_breadcrumbs` RPC mock instead of individual folder selects.

The "GET /folders signs documents as url:null" test has no subfolders, so it needs no size RPC mock, but needs the has_children query (which returns empty since no subfolder ids). This test should continue to pass without changes if the `folderIds.length > 0` guard is working.

- [ ] **Step 9: Run tests again**

Run: `deno test supabase/functions/__tests__/file-manage_test.ts`
Expected: ALL tests pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/file-manage/handler.ts supabase/functions/__tests__/file-manage_test.ts
git commit -m "feat: batch folder sizes, breadcrumb CTE, tree endpoint, blur PATCH, file URL"
```

---

### Task 5: Frontend service layer — add tree and file URL functions

**Files:**
- Modify: `apps/crm/src/services/fileService.ts`
- Modify: `apps/crm/src/pages/arquivos/types.ts`

- [ ] **Step 1: Add has_children to Folder type**

In `apps/crm/src/pages/arquivos/types.ts`, add to the `Folder` interface:

```ts
  has_children?: boolean;
  _optimistic?: boolean;
```

Add to the `FileRecord` interface:

```ts
  _uploading?: boolean;
  _progress?: number;
  _localPreviewUrl?: string;
```

- [ ] **Step 2: Add getTreeChildren function**

In `apps/crm/src/services/fileService.ts`, add:

```ts
export interface TreeNode {
  id: number;
  name: string;
  source: 'system' | 'user';
  source_type: 'client' | 'workflow' | 'post' | null;
  position: number;
  has_children: boolean;
}

export async function getTreeChildren(parentId: number | null): Promise<TreeNode[]> {
  const query: Record<string, string> = parentId ? { parent_id: String(parentId) } : {};
  return callFn<TreeNode[]>('file-manage', 'GET', undefined, query, '/tree');
}
```

- [ ] **Step 3: Add getFileDownloadUrl function**

```ts
export async function getFileDownloadUrl(fileId: number): Promise<string> {
  const { url } = await callFn<{ url: string }>('file-manage', 'GET', undefined, undefined, `/files/${fileId}/url`);
  return url;
}
```

- [ ] **Step 4: Add patchFileBlurHash function**

```ts
export async function patchFileBlurHash(fileId: number, blurDataUrl: string): Promise<void> {
  await callFn('file-manage', 'PATCH', { blur_data_url: blurDataUrl }, undefined, `/files/${fileId}`);
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/fileService.ts apps/crm/src/pages/arquivos/types.ts
git commit -m "feat: add tree, file URL, and blur hash PATCH service functions"
```

---

### Task 6: Unify cache keys + FolderTree uses tree endpoint

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FolderTree.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`

- [ ] **Step 1: Rewrite FolderTree to use getTreeChildren**

Replace the entire content of `FolderTree.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { getTreeChildren } from '@/services/fileService';
import type { TreeNode } from '@/services/fileService';

interface FolderNodeProps {
  folder: TreeNode;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRequestCreateFolder: (parentId: number | null) => void;
  depth: number;
}

function FolderNode({ folder, selectedFolderId, onSelectFolder, onRequestCreateFolder, depth }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: subfolders = [] } = useQuery({
    queryKey: ['folder-tree', folder.id],
    queryFn: () => getTreeChildren(folder.id),
    enabled: expanded,
  });

  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer group transition-colors duration-150 ${
          isSelected
            ? 'bg-[var(--primary-color)] text-[#12151a]'
            : 'hover:bg-[var(--surface-hover)] text-[var(--text-main)]'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        {folder.has_children ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="flex-shrink-0 p-0.5 rounded opacity-60 hover:opacity-100"
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="flex-shrink-0 w-[22px]" />
        )}

        <button
          onClick={() => onSelectFolder(folder.id)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {isSelected || expanded ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="truncate text-sm font-medium">{folder.name}</span>
          {folder.source === 'system' && (
            <span
              className={`flex-shrink-0 text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                isSelected
                  ? 'bg-[rgba(0,0,0,0.15)] text-[#12151a]'
                  : 'bg-[var(--surface-hover)] text-[var(--text-muted)]'
              }`}
            >
              AUTO
            </span>
          )}
        </button>

        {folder.source !== 'system' && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestCreateFolder(folder.id); }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded transition-opacity"
            aria-label="Nova subpasta"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && subfolders.length > 0 && (
        <div>
          {subfolders.map((sub) => (
            <FolderNode
              key={sub.id}
              folder={sub}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onRequestCreateFolder={onRequestCreateFolder}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderTreeProps {
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onRequestCreateFolder: (parentId: number | null) => void;
}

export function FolderTree({ selectedFolderId, onSelectFolder, onRequestCreateFolder }: FolderTreeProps) {
  const { data: rootFolders = [], isLoading } = useQuery({
    queryKey: ['folder-tree', null],
    queryFn: () => getTreeChildren(null),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {isLoading && (
          <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            Carregando...
          </div>
        )}

        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onRequestCreateFolder={onRequestCreateFolder}
            depth={0}
          />
        ))}

        {!isLoading && rootFolders.length === 0 && (
          <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            Nenhuma pasta
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-color)] p-2">
        <button
          onClick={() => onRequestCreateFolder(null)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
        >
          <Plus className="h-4 w-4" />
          Nova pasta
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Unify FilePickerModal cache key**

In `FilePickerModal.tsx`, change line 60:

```ts
// Before
    queryKey: ['picker-folder-contents', currentFolderId],
// After
    queryKey: ['folder-contents', currentFolderId],
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FolderTree.tsx apps/crm/src/pages/arquivos/components/FilePickerModal.tsx
git commit -m "feat: FolderTree uses lightweight tree endpoint, unify picker cache key"
```

---

### Task 7: Targeted cache invalidation + tree cache seeding + gcTime

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/FilePickerModal.tsx`

- [ ] **Step 1: Add gcTime, tree cache seeding, and targeted invalidation to ArquivosPage**

In `ArquivosPage.tsx`:

1. Add `useEffect` import (already imported).
2. Update the `useQuery` call to add `gcTime`:

```ts
  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
    gcTime: 5 * 60 * 1000,
  });
```

3. Add tree cache seeding effect after the `useQuery`:

```ts
  useEffect(() => {
    if (data?.subfolders) {
      queryClient.setQueryData(
        ['folder-tree', currentFolderId],
        data.subfolders.map(f => ({
          id: f.id,
          name: f.name,
          source: f.source,
          source_type: f.source_type,
          position: f.position,
          has_children: f.has_children ?? false,
        }))
      );
    }
  }, [data, currentFolderId, queryClient]);
```

4. Update `handleCreateFolder` with targeted invalidation:

```ts
  async function handleCreateFolder(name: string) {
    try {
      await createFolder(name, createFolderParent ?? null);
      queryClient.invalidateQueries({ queryKey: ['folder-contents', createFolderParent ?? null] });
      queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
      toast.success('Pasta criada');
    } catch {
      toast.error('Erro ao criar pasta');
    }
  }
```

5. Update `onUploadComplete` callbacks (two instances — desktop at line 228 and mobile at line 74) from:

```ts
onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ['folder-contents'] })}
```

to:

```ts
onUploadComplete={() => {
  queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
  queryClient.invalidateQueries({ queryKey: ['folder-tree', currentFolderId] });
}}
```

6. Update `onActionComplete` callbacks (two instances — desktop at line 241 and mobile at line 88) from:

```ts
onActionComplete={() => queryClient.invalidateQueries({ queryKey: ['folder-contents'] })}
```

to:

```ts
onActionComplete={() => {
  queryClient.invalidateQueries({ queryKey: ['folder-contents', currentFolderId] });
  queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
}}
```

- [ ] **Step 2: Add gcTime to FilePickerModal**

In `FilePickerModal.tsx`, update the query:

```ts
  const { data, isLoading } = useQuery({
    queryKey: ['folder-contents', currentFolderId],
    queryFn: () => getFolderContents(currentFolderId),
    enabled: open,
    gcTime: 5 * 60 * 1000,
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx apps/crm/src/pages/arquivos/components/FilePickerModal.tsx
git commit -m "feat: targeted cache invalidation, tree seeding, extended gcTime"
```

---

### Task 8: Hover prefetch + skeleton loading states

**Files:**
- Modify: `apps/crm/src/pages/arquivos/components/FileGrid.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx`
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`
- Modify: `apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx`

- [ ] **Step 1: Add hover prefetch and skeleton to FileGrid**

In `FileGrid.tsx`:

1. Add imports:

```ts
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getFolderContents } from '@/services/fileService';
```

2. Add `isLoading` prop to `FileGridProps`:

```ts
interface FileGridProps {
  files: FileRecord[];
  subfolders: FolderType[];
  onOpenFolder: (id: number) => void;
  onFileAction: (action: string, file: FileRecord) => void;
  viewMode: 'grid' | 'list';
  onActionComplete: () => void;
  sortBy?: SortBy;
  isLoading?: boolean;
}
```

3. At the top of the `FileGrid` component, add prefetch logic:

```ts
export function FileGrid({ files, subfolders, onOpenFolder, onFileAction, viewMode, onActionComplete, sortBy = 'name', isLoading }: FileGridProps) {
  const queryClient = useQueryClient();
  const prefetchTimeout = useRef<number>();

  function handleFolderMouseEnter(folderId: number) {
    prefetchTimeout.current = window.setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['folder-contents', folderId],
        queryFn: () => getFolderContents(folderId),
        staleTime: 30_000,
      });
    }, 150);
  }

  function handleFolderMouseLeave() {
    if (prefetchTimeout.current) {
      clearTimeout(prefetchTimeout.current);
      prefetchTimeout.current = undefined;
    }
  }
```

4. Add a skeleton rendering block right after the `isLoading` check but before the `isEmpty` check:

```ts
  if (isLoading) {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden animate-pulse">
            <div className="w-full aspect-square bg-[var(--surface-hover)]" />
            <div className="px-3 py-2 space-y-1.5">
              <div className="h-3 w-3/4 bg-[var(--surface-hover)] rounded" />
              <div className="h-2.5 w-1/2 bg-[var(--surface-hover)] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }
```

5. Add `onMouseEnter`/`onMouseLeave` to folder cards in grid mode. For each folder `<button>` in grid mode (around line 182), add:

```tsx
onMouseEnter={() => handleFolderMouseEnter(folder.id)}
onMouseLeave={handleFolderMouseLeave}
```

6. Add the same to folder rows in list mode (around line 107), on the `<tr>`:

```tsx
onMouseEnter={() => handleFolderMouseEnter(folder.id)}
onMouseLeave={handleFolderMouseLeave}
```

7. For optimistic entries, add conditional styling. In the folder grid `<button>` className, add:

```tsx
className={`group flex flex-col items-center gap-2 p-4 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-150 text-left ${
  (folder as any)._optimistic ? 'opacity-50 animate-pulse pointer-events-none' : ''
}`}
```

For file cards, add upload progress overlay. In the file grid card, after the thumbnail `<div>`, conditionally render:

```tsx
{(file as any)._uploading && (
  <div className="absolute inset-0 flex items-end bg-black/20">
    <div className="w-full h-1 bg-black/30">
      <div
        className="h-full bg-[var(--primary-color)] transition-all duration-300"
        style={{ width: `${(file as any)._progress ?? 0}%` }}
      />
    </div>
  </div>
)}
```

- [ ] **Step 2: Add skeleton to Breadcrumbs**

In `Breadcrumbs.tsx`, add an `isLoading` prop:

```tsx
interface BreadcrumbsProps {
  breadcrumbs: { id: number; name: string }[];
  onNavigate: (folderId: number | null) => void;
  isLoading?: boolean;
}

export function Breadcrumbs({ breadcrumbs, onNavigate, isLoading }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button
        onClick={() => onNavigate(null)}
        className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 font-medium"
      >
        Todos os Arquivos
      </button>

      {isLoading && breadcrumbs.length === 0 && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
          <span className="h-4 w-24 bg-[var(--surface-hover)] rounded animate-pulse" />
        </>
      )}

      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-50 flex-shrink-0" />
            {isLast ? (
              <span className="text-[var(--text-main)] font-medium truncate max-w-[200px]">
                {crumb.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(crumb.id)}
                className="text-[var(--text-muted)] hover:text-[var(--primary-color)] transition-colors duration-150 truncate max-w-[160px]"
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Update ArquivosPage to pass isLoading to children and remove Spinner**

In `ArquivosPage.tsx`, remove the `Spinner` import and update:

1. Pass `isLoading` to `Breadcrumbs`:

```tsx
<Breadcrumbs
  breadcrumbs={breadcrumbs}
  onNavigate={setCurrentFolderId}
  isLoading={isLoading}
/>
```

2. Replace the `isLoading` ternary with `FileGrid` receiving `isLoading`:

```tsx
<FileGrid
  files={files}
  subfolders={subfolders}
  onOpenFolder={setCurrentFolderId}
  onFileAction={handleFileAction}
  viewMode={viewMode}
  onActionComplete={...}
  sortBy={sortBy}
  isLoading={isLoading}
/>
```

Remove the `isLoading ? <Spinner /> :` wrapper entirely — `FileGrid` handles its own skeleton.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/components/FileGrid.tsx apps/crm/src/pages/arquivos/components/Breadcrumbs.tsx apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat: skeleton loading states, hover prefetch, optimistic entry styling"
```

---

### Task 9: Optimistic folder creation

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Convert handleCreateFolder to useMutation with optimistic update**

Add `useMutation` to the import from `@tanstack/react-query`.

Add `import type { FolderContents, Folder } from './types';` if not already imported.

Replace the `handleCreateFolder` function with:

```ts
  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder(name, createFolderParent ?? null),
    onMutate: async (name) => {
      const parentId = createFolderParent ?? null;
      await queryClient.cancelQueries({ queryKey: ['folder-contents', parentId] });
      const previous = queryClient.getQueryData<FolderContents>(['folder-contents', parentId]);
      queryClient.setQueryData<FolderContents>(['folder-contents', parentId], old => {
        if (!old) return old;
        const tempFolder: Folder = {
          id: -Date.now(),
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
      });
      return { previous, parentId };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(['folder-contents', context.parentId], context.previous);
      toast.error('Erro ao criar pasta');
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context) {
        queryClient.invalidateQueries({ queryKey: ['folder-contents', context.parentId] });
        queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
      }
    },
    onSuccess: () => toast.success('Pasta criada'),
  });
```

Update the `CreateFolderModal` `onConfirm` prop to use the mutation:

```tsx
onConfirm={(name) => createFolderMutation.mutate(name)}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat: optimistic folder creation with rollback on error"
```

---

### Task 10: Non-blocking upload pipeline + concurrency limit

**Files:**
- Modify: `apps/crm/src/services/fileService.ts`
- Modify: `apps/crm/src/pages/arquivos/components/FileUploader.tsx`

- [ ] **Step 1: Cap video thumbnail resolution in FileUploader**

In `FileUploader.tsx`, update the `captureVideoThumbnail` function. Replace the canvas sizing (lines 44-46):

```ts
      // Before:
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      // After:
      const MAX_THUMB_WIDTH = 400;
      const scale = video.videoWidth > MAX_THUMB_WIDTH ? MAX_THUMB_WIDTH / video.videoWidth : 1;
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
```

- [ ] **Step 2: Reorder image upload for parallel probe + non-blocking blur hash**

In `fileService.ts`, rewrite the `uploadFile` function:

```ts
export async function uploadFile(args: {
  file: File;
  folderId: number | null;
  thumbnail?: File;
  onProgress?: (p: UploadProgress) => void;
  postId?: number;
}): Promise<FileRecord> {
  const { file, folderId, thumbnail, onProgress, postId } = args;

  const kind = file.type.startsWith('image/') ? 'image'
    : file.type.startsWith('video/') ? 'video'
    : 'document';

  // For images: probe dimensions in parallel with URL request
  let dimensionPromise: Promise<{ width: number; height: number }> | undefined;
  if (kind === 'image') {
    dimensionPromise = probeImage(file);
  }

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

  if (kind === 'image' && dimensionPromise) {
    const dims = await dimensionPromise;
    width = dims.width;
    height = dims.height;
  } else if (kind === 'video') {
    const dims = await probeVideo(file);
    width = dims.width;
    height = dims.height;
    duration_seconds = dims.duration_seconds;
  }

  // Finalize immediately WITHOUT blur hash
  const record = await callFn<FileRecord>('file-upload-finalize', 'POST', {
    file_id: signed.file_id,
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    kind: signed.kind,
    mime_type: file.type,
    size_bytes: file.size,
    name: file.name,
    folder_id: folderId,
    width, height, duration_seconds,
    post_id: postId,
  });

  // Generate and PATCH blur hash in background (non-blocking)
  if (kind === 'image') {
    generateBlurDataUrl(file)
      .then(blur => patchFileBlurHash(record.id, blur))
      .catch(() => {});
  }

  return record;
}
```

- [ ] **Step 3: Add concurrency-limited upload queue to FileUploader**

In `FileUploader.tsx`, add a concurrency limiter. Replace the `processFiles` callback:

```ts
  const activeUploads = useRef(0);
  const pendingQueue = useRef<{ file: File; itemId: string }[]>([]);
  const MAX_CONCURRENT = 3;

  const startUpload = useCallback(
    (file: File, itemId: string) => {
      activeUploads.current++;
      mutation.mutate(
        { file, itemId },
        {
          onSettled: () => {
            activeUploads.current--;
            const next = pendingQueue.current.shift();
            if (next) startUpload(next.file, next.itemId);
          },
        },
      );
    },
    [mutation],
  );

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) => f.type !== '');

      for (const file of fileArray) {
        const itemId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        setQueue((prev) => [
          ...prev,
          { id: itemId, name: file.name, progress: 0, status: 'uploading' },
        ]);

        if (activeUploads.current < MAX_CONCURRENT) {
          startUpload(file, itemId);
        } else {
          pendingQueue.current.push({ file, itemId });
        }
      }
    },
    [startUpload],
  );
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Run backend tests**

Run: `deno test supabase/functions/`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/services/fileService.ts apps/crm/src/pages/arquivos/components/FileUploader.tsx
git commit -m "feat: non-blocking upload pipeline, 400px thumbnail cap, 3-upload concurrency limit"
```

---

### Task 11: File preview — images, videos, and documents

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx`

- [ ] **Step 1: Add lightbox state and handleFileAction implementation**

Add imports at the top of `ArquivosPage.tsx`:

```ts
import { PostMediaLightbox } from '../entregas/components/PostMediaLightbox';
import { getFileDownloadUrl } from '@/services/fileService';
import type { PostMedia } from '../../store';
```

Add state after `uploaderRef`:

```ts
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
```

Add computed media array after the `files` destructure:

```ts
  const mediaFiles = files.filter(f => f.kind === 'image' || f.kind === 'video');
  const lightboxMedia: PostMedia[] = mediaFiles.map(f => ({
    id: f.id,
    post_id: 0,
    conta_id: f.conta_id,
    r2_key: f.r2_key,
    thumbnail_r2_key: f.thumbnail_r2_key,
    kind: f.kind as 'image' | 'video',
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    original_filename: f.name,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: false,
    sort_order: 0,
    uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    blur_data_url: f.blur_data_url,
    url: f.url,
    thumbnail_url: f.thumbnail_url,
  }));
```

Replace the `handleFileAction` stub:

```ts
  function handleFileAction(action: string, file: FileRecord) {
    if (action !== 'open') return;

    if (file.kind === 'image' || file.kind === 'video') {
      const idx = mediaFiles.findIndex(f => f.id === file.id);
      if (idx >= 0) {
        setLightboxIndex(idx);
        setLightboxOpen(true);
      }
    } else {
      if (file.url) {
        window.open(file.url, '_blank');
      } else {
        getFileDownloadUrl(file.id)
          .then(url => window.open(url, '_blank'))
          .catch(() => toast.error('Erro ao abrir arquivo'));
      }
    }
  }
```

- [ ] **Step 2: Render PostMediaLightbox in both desktop and mobile JSX**

In the desktop JSX, add right before the closing `</div>` of the main container (before the `<CreateFolderModal>`):

```tsx
      <PostMediaLightbox
        media={lightboxMedia}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
```

In the mobile JSX (the `if (isMobile)` return), add the same component before `<CreateFolderModal>`:

```tsx
        <PostMediaLightbox
          media={lightboxMedia}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/arquivos/ArquivosPage.tsx
git commit -m "feat: file preview with lightbox for images/videos, new tab for documents"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `deno test supabase/functions/`
Expected: All tests pass.

- [ ] **Step 2: Run frontend typecheck + build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Run frontend tests**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`

Verify in browser:
1. Navigate to `/arquivos` — folder tree loads with lightweight tree endpoint
2. Hover over a folder card — network tab shows prefetch request after ~150ms
3. Click into a folder — content appears instantly if prefetched
4. Navigate back — cached content shown immediately
5. Create a new folder — appears instantly with subtle pulse animation, then solidifies when server confirms
6. Upload a file — video thumbnails are fast (400px cap), image blur hash is non-blocking
7. Upload 5+ files simultaneously — only 3 upload at a time, rest queue
8. Click an image file — lightbox opens with carousel
9. Click a video file — lightbox opens with video player
10. Click a PDF/document file — opens in new browser tab
11. Right-click context menu actions (rename, delete) still work and invalidate correctly
12. FolderTree sidebar updates when creating/deleting folders
13. FilePickerModal (from post editor) shares cache with main Arquivos page

- [ ] **Step 5: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
