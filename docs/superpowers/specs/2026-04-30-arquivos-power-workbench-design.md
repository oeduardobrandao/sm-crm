# Arquivos — Power Workbench (Phase 1) — Design Spec

Six features that turn `apps/crm/src/pages/arquivos/` from a single-file viewer into a multi-file workbench, without breaking the existing single-click open/navigate behavior. Phase 1 of a 3-phase plan; Phases 2 (Lixeira) and 3 (busca global, links públicos) are out of scope here and tracked separately.

## Phase 1 Scope

Six features:

1. **Move files & folders** — drag-and-drop (desktop) + "Mover para…" picker (everywhere)
2. **Download folder as ZIP** — sync edge function streaming, 1 GB / 500-file cap
3. **Multi-select & bulk actions** — hover checkbox (desktop) / long-press (mobile); floating bottom pill
4. **Filter by type** — "Filtros" popover panel (room to grow into uploader / date later)
5. **Inline rename** — F2 or double-click on the name label
6. **Copy / Duplicate** — server-side R2 COPY produces an independent new row; reuses the Move picker

## Decisions

- **Selection model:** hover checkbox on desktop (single-click still navigates / opens), long-press to enter selection mode on mobile (then tap to toggle). Same primitive in two gestures.
- **Move UX:** both drag-and-drop and a "Mover para…" picker modal. Drag is desktop-only; the picker is the universal path for mobile, keyboard, and discoverability. Both call the same backend endpoint.
- **System-folder rules (Phase 1):** files can be moved or copied INTO and OUT of system folders freely. User folders can be moved into `client` or `workflow` system folders, but **not** into `post` system folders (post folders are leaf-only). The system folder *itself* cannot be moved (it's tied to a client / workflow / post entity). The post-folder auto-organization trigger fires only on file creation — it never overrides a manual move. See the validity matrix for the complete picture.
- **Bulk action bar:** floating pill at the bottom of the content area. The toolbar / breadcrumbs stay visible during selection.
- **Selection persistence:** selection clears whenever the user navigates to a different folder. Bulk operations are scoped to one folder at a time. Filter state, in contrast, persists across navigation.
- **ZIP backend:** sync streaming from a new `file-zip` edge function. Hard cap 1 GB / 500 files per archive. Over the cap → friendly 413 with the actual totals; users select a subset.
- **Copy semantics:** true duplicate via R2 server-side COPY. New `files` row gets its own `r2_key`. Each copy is independent; storage quota counts both.
- **Filter UX:** popover panel with type checkboxes (Imagens / Vídeos / Docs) and a small badge showing the active-filter count. Future filter dimensions (uploader, date) slot into the same panel.
- **Inline rename:** F2 on a focused tile, or double-click on the name *label* (not the thumbnail — that still opens / navigates). Mobile keeps the existing rename modal.
- **Mobile parity:** all features ship on mobile *except* inline rename (mobile keeps its existing rename modal). Drag-and-drop is desktop-only by definition; the picker covers mobile.
- **No schema migrations.** Move is a `parent_id` / `folder_id` update. Copy is R2 COPY + new row using existing columns. ZIP is read-only. Filters are client-side. Inline rename hits the existing PATCH. One new Postgres RPC (`bulk_move_items`) requires a migration file, but it adds no tables or columns — just a function.

## Out of Scope (deferred)

- **Phase 2** — Lixeira (soft-delete + 30-day restore + cleanup cron)
- **Phase 3** — Global file search; public link sharing with expiry
- Hub-folder visibility (sharing folders with the client portal); favorites / recents; folder color/icon. Not asked for in this engagement; revisit later if user feedback surfaces them.

## Architecture

### Frontend — files touched

`apps/crm/src/pages/arquivos/`:

- `ArquivosPage.tsx` — host the selection state, bulk bar, filter state, picker modal, drag context. Mostly composition glue.
- `components/FileGrid.tsx` — render hover checkbox, selection ring, drag source, "double-click name → inline rename" target.
- `components/FolderTree.tsx` — drop targets on tree nodes; expand-on-hover-during-drag (500 ms).
- `components/FileContextMenu.tsx` — add "Mover para…" and "Copiar para…" items; route Rename to the inline rename instead of the modal on desktop. Mobile: receives an `isMobile` prop (from the existing responsive hook) to keep the rename modal and hide drag-only options.
- `components/MobileArquivosView.tsx` — long-press (400 ms threshold with subtle haptic/scale feedback) to enter selection mode; mobile pill bar docked at bottom. Exit selection via `✕` in header, `✕` in pill bar, or browser back gesture. `onTouchMove` during long-press cancels the timer (prevents accidental selection while scrolling).

`apps/crm/src/services/fileService.ts` — add `bulkMove`, `bulkDelete`, `copyFile`, `copyFolder`, `requestZipDownload`.

### Frontend — files added

`apps/crm/src/pages/arquivos/`:

- `hooks/useSelection.ts` — `{ selectedIds, anchor, isSelected, toggle, toggleRange, clear, prune, count }`. Generic over `{ id: number }`. Tracks anchor for shift-click range selection.
- `hooks/useDragDrop.ts` — native HTML5 drag-and-drop wiring; no library. Internal vs. external drag disambiguated via `dataTransfer.types` (external uploads carry `"Files"`; internal moves carry `"application/x-arquivos"`).
- `components/BulkActionBar.tsx` — floating pill (desktop) / docked bottom sheet (mobile). Shows count, Mover, Baixar ZIP, Copiar, Excluir, clear.
- `components/FolderPickerModal.tsx` — shared by Move and Copy. Renders the folder tree with disabled state for invalid targets (source folder, descendants of any source folder, sealed system-folder rules — see validity matrix below).
- `components/FilterPopover.tsx` — type checkboxes + active-count badge. Filter state lives in `ArquivosPage`. Filtering is client-side on the already-fetched list (subfolders always shown; files filtered by `kind`).
- `components/InlineRenameInput.tsx` — auto-focused, auto-selected `<input>` that replaces the name label. Commits on blur or Enter; reverts on Escape.

### Backend — new endpoints in `supabase/functions/file-manage/handler.ts`

All endpoints enforce `conta_id` ownership and the system-folder validity matrix.

- `POST /file-manage/bulk-move` — `{ file_ids[], folder_ids[], destination_id: number | null }` (null = root). Atomic via a new Postgres RPC `bulk_move_items(p_conta_id, p_file_ids, p_folder_ids, p_destination_id)` so all updates commit or roll back together. The RPC validates every item belongs to `conta_id`, target is reachable, no folder is being moved into itself or a descendant. Any failure rolls back and returns `400` with `{ error, invalid_ids }`. The handler reuses the same validation logic as the existing single-item `PATCH /files/:id` and `PATCH /folders/:id` endpoints — extract shared helpers (`assertOwnership`, `assertNotCycle`, `assertSystemFolderRules`) so both paths stay consistent.
- `POST /file-manage/bulk-delete` — `{ file_ids[], folder_ids[] }`. Partitions items: any file with `reference_count > 0` or any system folder is "blocked." Returns `409` with `{ blocked, deletable }` *without deleting anything* if the partition is non-empty. Frontend re-issues with just `deletable` ids on user confirmation. On successful deletion, decrements `workspaces.storage_used_bytes` by the sum of deleted files' `size_bytes`. Reuses the same ownership check as the existing single-item `DELETE /files/:id`.
- `POST /file-manage/files/:id/copy` — `{ destination_folder_id }`. Pre-checks remaining quota; refuses with `413 quota_exceeded` if the copy bytes don't fit. Performs R2 server-side COPY for the file's `r2_key` (and `thumbnail_r2_key` if present) using a new `copyObject(sourceKey, destKey)` helper in `_shared/r2.ts` (wraps `CopyObjectCommand` from `@aws-sdk/client-s3`), then inserts a new `files` row with the new keys, `folder_id = destination`, fresh `reference_count = 0`. The copy does NOT carry over `post_file_links` — it's a standalone file with no post associations.
- `POST /file-manage/folders/:id/copy` — `{ destination_folder_id: number | null }`. Hard limits: max depth 10 levels, max 200 files total across the tree. Exceeding either → `413 copy_limit_exceeded` before any work begins. Pre-compute total bytes across all files in the tree and refuse with `413 quota_exceeded` if `used + total_copy_bytes > quota`, also before any work. Then recursive depth-first: create folder rows top-down, copy files per-folder. Per-file flow: R2 COPY → insert row. R2 COPY failures are skipped and logged (no orphan R2 object since the row is only inserted on success). Insert failures are rare; if they occur, the R2 object is left orphaned and accepted as best-effort. Frontend gets an "X of Y copied" toast on partial success.

### Backend — new edge function `supabase/functions/file-zip/`

ZIP downloads can't carry an `Authorization` header (the browser triggers them as plain navigations), so the auth flow is split:

1. **Token issuance** — Frontend POSTs `/file-manage/zip-token` with `{ folder_id }` or `{ file_ids: number[] }`. `file-manage` validates ownership, runs the cap pre-check (sum sizes, count files via SQL), and returns `{ token, download_url }`. Token is HMAC-signed with `ZIP_TOKEN_SECRET`; payload `{ conta_id, folder_id | file_ids, expires_at }`; TTL 5 minutes. The token encodes the exact scope (specific folder or file IDs) so a stolen token can only download those specific items, not arbitrary files from the account.
2. **Download** — Frontend creates a hidden `<a href={download_url} download>` and `click()`s it. Browser navigates to `GET /file-zip?token=...`.
3. **Streaming** — `file-zip` verifies the token (signature + expiry + `conta_id`), walks the tree, and streams: for each file, fetch from R2 → write into a zip stream (`@zip-js/zip-js`, Deno-compatible) → flush. Sets `Content-Disposition: attachment; filename="..."`.

Cap pre-check happens during token issuance. If `total_bytes > 1 GB` or `file_count > 500`, the issuance call returns `413 zip_limit_exceeded` with `{ total_bytes, file_count, limit_bytes, limit_files }`. No token is created. Frontend surfaces a toast.

**Deno Deploy constraints:** Deno Deploy has a 400-second wall-time limit per request. For large archives near the 1 GB cap, the bottleneck is R2 fetch throughput (not CPU). The streaming design (fetch → zip → flush per file) keeps memory bounded and CPU low. If a request hits the wall-time limit, the browser receives a truncated stream — the download will fail or produce a corrupt ZIP. The 1 GB / 500-file cap is sized to stay well within this limit under normal R2 latency. If we observe timeouts in production, lower the cap.

**R2 mid-stream failures:** Once streaming has begun (HTTP 200 already sent), the status code can't change. If an R2 fetch fails mid-stream, the file is skipped: an empty entry is written to the ZIP with a `.skipped` suffix, and a warning header `X-Zip-Skipped` is appended (though browsers may not surface it). The edge function logs the skip. Partial ZIPs are the accepted trade-off — the alternative (buffering the entire archive before responding) would blow memory limits.

### Why these abstractions

- `FolderPickerModal` is the only place that knows the destination-validity rules; Move and Copy reuse it, so the rules live in one component and are re-validated by the backend.
- `useSelection` is generic, so the bulk bar handles a mixed selection of files and folders without special-casing.
- `useDragDrop` keeps drag wiring out of `FileGrid` and `FolderTree`, both of which stay focused on rendering.

## Folder Move / Copy Validity Matrix

| Source | Target | Allowed? |
|---|---|---|
| User file | Anywhere (incl. inside any system folder) | ✓ |
| User folder | Inside another user folder | ✓ |
| User folder | Inside a `client` or `workflow` system folder | ✓ |
| User folder | Inside a `post` system folder | ✗ — post folders accept files but not subfolders |
| System folder (any kind) | Anywhere | ✗ — folder itself is sealed to its entity |
| Any | Source folder, or a descendant of any source folder | ✗ — cycle |
| Any | Same folder it's already in | ✗ — no-op (frontend skips the call) |

`FolderPickerModal` greys out invalid destinations and shows a tooltip ("Pasta de sistema — destino não permitido" / "Movimento criaria ciclo"). The backend re-validates and returns `400` on bypass attempts.

## Data Flow

### Selection state

`useSelection` exposes:

```
selectedIds: Set<number>
anchor: number | null         // last single-click target, used for shift-click range
toggle(id)                    // sets anchor = id
toggleRange(id, items)         // selects from anchor → id in items' display order
prune(displayedIds)           // drops stale ids when the rendered list changes
clear()                       // also resets anchor
```

`ArquivosPage` clears selection in a `useEffect` watching `currentFolderId` (rule: clears on navigation). It calls `prune` inside `onSuccess` of mutations (move, delete, copy) — not in a `useEffect` watching the rendered list, to avoid a flash where the pill bar shows a stale count between the mutation settling and the re-render. Display order for shift-click matches the rendered grid: the flat array is `[...subfolders, ...files]` ordered by current `sortBy`. Shift-click range selection walks this flat array from `anchor` to `target`, selecting every item in between regardless of whether it's a folder or file (mixed selection is first-class).

### Move (drag-and-drop)

1. `onDragStart(item)` — if `item.id ∈ selectedIds`, drag the whole selection; otherwise drag just this item. Set `dataTransfer.setData('application/x-arquivos', JSON.stringify({fileIds, folderIds}))`. Create a drag ghost by rendering a small off-screen DOM element (a styled `<div>` with the count label, e.g. "Mover 3 itens") and passing it to `dataTransfer.setDragImage(element, 0, 0)`. The element is appended to `document.body` before `setDragImage` and removed in `onDragEnd`.
2. `onDragOver(target)` — call `isValidDropTarget(source, target)` (see validity matrix). If valid: `preventDefault()` + highlight target. Tree nodes auto-expand after 500 ms of hover during a drag.
3. `onDrop(target)` — POST `/file-manage/bulk-move`. Optimistic update: remove items from the current folder's TanStack Query cache.
4. On error: rollback + toast. On success: invalidate `folder-contents` for both source and destination, plus `folder-tree`.

### Move (picker, used by mobile + context menu)

Same backend call as drag-and-drop. The `FolderPickerModal` renders the folder tree with invalid destinations disabled. On confirm, it issues the same `POST /file-manage/bulk-move`.

### Copy

Same UX as Move (drag and picker), different endpoint. Backend per item:

1. Fetch source `files` row, verify `conta_id`.
2. Pre-check quota: if `used + total_copy_bytes > quota`, return `413 quota_exceeded` *before* any R2 work.
3. Generate a new `r2_key` (e.g., `{conta_id}/{uuid}-{filename}`).
4. R2 server-side COPY from `source.r2_key` to the new key. Same for `thumbnail_r2_key`.
5. Insert new `files` row with new keys, `folder_id = destination`, `reference_count = 0`. The copy does NOT carry over `post_file_links`.
6. Update `workspaces.storage_used_bytes`.

For folder copy: depth-first walk. Per file: R2 COPY then INSERT. R2 failures are logged and skipped (no orphan R2 object). Frontend gets an "X of Y copied" toast on partial success.

### Bulk delete

1. Frontend confirm dialog with explicit count.
2. `POST /file-manage/bulk-delete`. Backend partitions; if any item is blocked (file `reference_count > 0`, or system folder), return `409 { blocked, deletable }` without deleting.
3. Frontend on `409` shows: "X itens não podem ser excluídos: [list]. Excluir os outros Y?" — user can confirm a follow-up call with just the `deletable` ids.

### ZIP download

1. Frontend POSTs `/file-manage/zip-token`. Backend validates ownership, runs the cap pre-check, signs a token, returns `{ token, download_url }`. Cap exceeded → `413 zip_limit_exceeded` with totals; no token issued.
2. Frontend triggers download via a hidden `<a href={download_url} download>` that's `click()`-ed. (Equivalent to `window.location.href`, but keeps the SPA route untouched.)
3. `file-zip` verifies the token, streams the archive: walk → fetch R2 → write to zip stream → flush.

### Inline rename

F2 on focused tile, or double-click on the name label, replaces the label with `InlineRenameInput`. On commit (blur or Enter): optimistic cache write, then PATCH `/file-manage/folders/:id` or `/file-manage/files/:id`. Empty or unchanged name → silent revert with no API call. Escape reverts.

### Filter

Filter state lives in `ArquivosPage` as a `FilterState` object: `{ types: Set<'image' | 'video' | 'document'> }`. The type is an object (not a bare `Set`) so future filter dimensions (uploader, date range) add as new keys without breaking the shape. Filter is applied client-side on the already-fetched list — subfolders are always shown; files are filtered by `kind`. Filter persists across navigation. Empty filter set (all types unchecked) shows an empty state with a "Limpar filtros" CTA. On mobile, the filter popover renders the same checkbox UI inside a bottom sheet instead of a popover (triggered by the same "Filtros" button).

## Error Handling & Edge Cases

- **Selection vs. data drift:** `useSelection.prune` is called in mutation `onSuccess` callbacks (not in a render-watching `useEffect`) to avoid a flash of stale count between mutation and re-render. Also called on TanStack Query refetch (`onSuccess` of the folder-contents query) for cross-tab drift. Pill bar count updates automatically.
- **Drag-and-drop disambiguation:** internal moves and external uploads coexist. Handlers check `dataTransfer.types`: external = `"Files"`, internal = `"application/x-arquivos"`.
- **Drag onto source folder or descendant:** pre-computed descendant set blocks the drop client-side; the backend re-validates.
- **Bulk-move atomicity:** single SQL transaction. Any one failure rolls the whole operation back; toast lists the offending ids.
- **Bulk-delete partial blocking:** 409 returns `{ blocked, deletable }`; nothing is deleted on the first call. Second call (after user opt-in) deletes only `deletable`.
- **ZIP empty target:** frontend disables the ZIP button when recursive `total_file_count` is 0.
- **ZIP file deleted mid-stream:** silently skip and continue. Final ZIP has fewer files than expected. Edge function logs the skip for observability.
- **ZIP R2 fetch failure mid-stream:** same — skip, continue, log.
- **ZIP token expired:** `file-zip` returns 401. Frontend retries once silently (re-issue + re-trigger). Second failure surfaces a toast.
- **ZIP cancel mid-download:** browser closes the stream, edge function aborts. Nothing persisted.
- **Copy quota exceeded:** `413 quota_exceeded` returned *before* any R2 work. Toast: "Cópia excederia o armazenamento (X GB de Y GB). Libere espaço ou faça upgrade."
- **Inline rename concurrent edits:** last write wins. No version checks in Phase 1.
- **Filter empty state:** all types unchecked → empty state with "Limpar filtros" CTA, not a silent blank screen.
- **Race conditions across tabs:** all mutations rely on TanStack Query's `onError` rollback and post-success invalidation of source folder, destination folder, and folder-tree caches.
- **Concurrent bulk operations:** no client-side locking in Phase 1 — if the user fires two bulk-moves simultaneously, both hit the RPC independently. The RPC's transaction isolation handles row-level conflicts (one succeeds, the other fails with `400` since the item has already moved). Frontend disables the bulk bar buttons while a mutation is in-flight (`isPending` from `useMutation`) to prevent accidental double-fires.

## Security

- Every new endpoint verifies the user's session and resolves `conta_id` from the `profiles` row, then checks that every input id (file_id, folder_id, destination_id) belongs to that `conta_id`. No client-supplied `conta_id` is trusted.
- ZIP token: HMAC-SHA256 with `ZIP_TOKEN_SECRET` env var (no fallback — throws on missing). Payload encodes `{ conta_id, folder_id | file_ids, expires_at }` — the token is scoped to specific items, not the entire account. `file-zip` re-checks `conta_id` on every file fetch even though the token already encodes it. Key rotation: deploy new secret, old tokens (max 5-min TTL) expire naturally. No dual-key needed.
- CORS: use existing `buildCorsHeaders(req)` on all new endpoints. No wildcards.
- Rate-limit: No in-memory rate-limit for Phase 1 (Deno Deploy isolates are ephemeral — counters reset on cold starts). The 1 GB / 500-file cap per archive and the 5-minute token TTL provide natural abuse bounds. If abuse appears, add a Supabase counter table keyed by `(user_id, minute)` in a follow-up.
- **Audit trail:** Bulk-move, bulk-delete, and copy operations log to the existing `audit_log` table via `insertAuditLog()` from `_shared/audit.ts`. Logged fields: action type, user ID, `conta_id`, item IDs, destination, and outcome (success / partial / error). Single-item operations already audit-log through the existing endpoints.

## Testing Strategy

### Edge function tests (Deno)

`supabase/functions/file-manage/__tests__/`:

- `bulk-move`: rejects on cycle (folder targets a descendant); rejects on sealed-folder violations; transaction rolls back on any failure; no partial state.
- `bulk-delete`: returns 409 with correct `blocked` / `deletable` partition; doesn't delete anything on 409.
- `copy` (file and folder): refuses with 413 when copy bytes would exceed quota; succeeds and increments `storage_used_bytes` correctly; recursive folder copy preserves structure.

`supabase/functions/file-zip/__tests__/`:

- HMAC token verifies on the happy path.
- Expired token returns 401.
- `conta_id` mismatch in token returns 401 even with valid signature.
- Cap pre-check during token issuance returns 413 with actual totals.

### Frontend hook / util tests (Vitest)

`apps/crm/src/pages/arquivos/__tests__/`:

- `useSelection`: `toggle`, `toggleRange` against a fixed display order, `prune` removes stale ids while preserving the anchor, `clear` resets anchor.
- `isValidDropTarget`: table-driven test covering each row of the validity matrix.
- `FolderPickerModal` selection logic: disabled state propagates correctly for descendants and `post` system folders.

### Component tests (lighter, for trickiest UI)

- `BulkActionBar`: shows correct count, disabled state when only files-in-use are selected, clears on Esc.
- `InlineRenameInput`: Enter commits, Escape reverts, blur commits, empty value reverts silently.

### Manual smoke checklist (PR description)

- [ ] Drag a single file from the grid onto a tree node
- [ ] Select 3 items, drag onto a folder card in the grid
- [ ] Drag selection onto a deep tree branch (verify hover-to-expand triggers)
- [ ] Move via picker with one invalid target visible-but-disabled
- [ ] Copy a folder containing subfolders and a video; verify both copies are independent (rename one, the other stays)
- [ ] ZIP a folder with ~50 files, ~50 MB — confirm streaming starts within ~1 s
- [ ] Trigger ZIP cap with a deliberately oversized folder; confirm friendly 413 toast
- [ ] Bulk delete with one file linked to a post; confirm the partial-delete dialog
- [ ] Inline rename via F2 on focused tile, again via double-click on the name label
- [ ] Mobile: long-press → tap to add → mover via picker → confirm
- [ ] Filter: toggle types, navigate to a different folder, verify filter persists

End-to-end browser automation is out of scope — the codebase has no Playwright/Cypress today, and adding it for this feature is a bigger investment than the feature itself.

## Environment Variables

New:
- `ZIP_TOKEN_SECRET` — HMAC secret for ZIP download tokens. Required; edge functions throw on missing (no fallback).

Unchanged but used:
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — for R2 server-side COPY and signed-URL fetches.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — for `file-zip` to read file rows during streaming.

## Prerequisites (existing code changes)

- **`_shared/r2.ts`** — add `copyObject(sourceKey: string, destKey: string)` helper wrapping `CopyObjectCommand` from `@aws-sdk/client-s3`. Used by the copy endpoints.
- **New Postgres migration** — creates the `bulk_move_items` RPC function. No schema changes (no new tables or columns).

## Build Sequence

Suggested implementation order (each step independently testable):

1. **`useSelection` + hover checkbox UI** — the foundation. No backend.
2. **Inline rename** — small, isolated. Hits the existing PATCH endpoint.
3. **Filter popover** — client-side only. No backend.
4. **`FolderPickerModal` + Move via picker + bulk-move endpoint** — first feature wired end-to-end.
5. **Drag-and-drop Move** — reuses the bulk-move endpoint from step 4.
6. **Bulk delete + partial-blocking dialog** — reuses the selection model from step 1.
7. **Copy (file + folder)** — reuses the picker from step 4; new endpoints + R2 COPY.
8. **ZIP token + `file-zip` edge function + ZIP button wiring** — the largest single piece; depends on nothing above.
9. **Mobile parity** — long-press into selection mode, mobile pill bar, picker reuse. Polish step over the desktop work.
